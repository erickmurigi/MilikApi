import mongoose from "mongoose";
import RentPayment from "../../models/RentPayment.js";
import Tenant from "../../models/Tenant.js";
import TenantInvoice from "../../models/TenantInvoice.js";
import User from "../../models/User.js";
import Unit from "../../models/Unit.js";
import Property from "../../models/Property.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import { emitToCompany } from "../../utils/socketManager.js";
import { postEntry, postReversal } from "../../services/ledgerPostingService.js";
import { aggregateChartOfAccountBalances } from "../../services/chartAccountAggregationService.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const populateReceiptQuery = (query) =>
  query
    .populate("tenant", "name email phone unit")
    .populate({ path: "unit", select: "unitNumber property", populate: { path: "property", select: "propertyName propertyCode" } })
    .populate("confirmedBy", "surname otherNames email")
    .populate("ledgerEntries");

const resolveBusinessId = (req) => {
  return (
    req.user?.company ||
    req.body?.business ||
    req.query?.business ||
    null
  );
};

const resolveActorUserId = async ({ req, business, fallbackUserId = null }) => {
  const candidates = [fallbackUserId, req.user?.id, req.user?._id].filter(Boolean);

  for (const candidate of candidates) {
    if (isValidObjectId(candidate)) {
      const existingUser = await User.findById(candidate).select("_id company isActive").lean();
      if (existingUser && existingUser.isActive !== false) {
        return String(existingUser._id);
      }
    }
  }

  if (!business || !isValidObjectId(business)) {
    throw new Error("Unable to resolve acting user because business is missing or invalid.");
  }

  const companyAdmin = await User.findOne({
    company: business,
    isActive: true,
    $or: [{ adminAccess: true }, { superAdminAccess: true }],
  })
    .sort({ superAdminAccess: -1, adminAccess: -1, createdAt: 1 })
    .select("_id company")
    .lean();

  if (companyAdmin?._id) {
    return String(companyAdmin._id);
  }

  const anyActiveCompanyUser = await User.findOne({
    company: business,
    isActive: true,
  })
    .sort({ createdAt: 1 })
    .select("_id company")
    .lean();

  if (anyActiveCompanyUser?._id) {
    return String(anyActiveCompanyUser._id);
  }

  throw new Error(
    "No valid company user could be resolved for receipt posting. Create at least one real user under this company, or submit a valid User ObjectId."
  );
};

const normalizeDate = (value, fallback = new Date()) => {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback) : date;
};

const generateReceiptNumber = async (businessId) => {
  const prefix = "REC";

  const lastPayment = await RentPayment.findOne(
    {
      business: businessId,
      receiptNumber: { $regex: `^${prefix}\\d+$` },
    },
    { receiptNumber: 1 },
    { sort: { createdAt: -1 } }
  );

  let sequence = 1;
  if (lastPayment?.receiptNumber) {
    const numericPart = parseInt(lastPayment.receiptNumber.replace(prefix, ""), 10) || 0;
    sequence = numericPart + 1;
  }

  return `${prefix}${String(sequence).padStart(5, "0")}`;
};

const getStatementPeriodFromPayment = (payment) => {
  const paymentDate = normalizeDate(payment?.paymentDate, new Date());
  const fallbackMonth = paymentDate.getMonth() + 1;
  const fallbackYear = paymentDate.getFullYear();

  const month = Number(payment?.month || fallbackMonth);
  const year = Number(payment?.year || fallbackYear);

  const start = new Date(year, Math.max(month - 1, 0), 1, 0, 0, 0, 0);
  const end = new Date(year, Math.max(month, 1), 0, 23, 59, 59, 999);

  return { start, end };
};

const getReceiptStatementCategory = (payment) => {
  const paidDirect = !!payment?.paidDirectToLandlord;

  switch (payment?.paymentType) {
    case "rent":
      return paidDirect ? "RENT_RECEIPT_LANDLORD" : "RENT_RECEIPT_MANAGER";
    case "utility":
      return paidDirect ? "UTILITY_RECEIPT_LANDLORD" : "UTILITY_RECEIPT_MANAGER";
    case "deposit":
      return "DEPOSIT_RECEIVED";
    case "late_fee":
    case "other":
    default:
      return "ADJUSTMENT";
  }
};

const getCreditPostingRole = (paymentType) => {
  switch (paymentType) {
    case "rent":
    case "utility":
      return "tenant_receivable";
    case "deposit":
      return "tenant_deposit_liability";
    case "late_fee":
    case "other":
    default:
      return "other_income";
  }
};

const resolvePropertyAndLandlord = async (payment) => {
  const unit = await Unit.findById(payment.unit).select("property").lean();
  if (!unit?.property) {
    throw new Error("Unit is not linked to a property.");
  }

  const property = await Property.findById(unit.property).select("landlords").lean();
  if (!property) {
    throw new Error("Property not found for the selected unit.");
  }

  const landlords = Array.isArray(property.landlords) ? property.landlords : [];
  const primary = landlords.find((item) => item?.isPrimary && item?.landlordId);
  const fallback = landlords.find((item) => item?.landlordId);
  const landlordId = primary?.landlordId || fallback?.landlordId || null;

  if (!landlordId) {
    throw new Error("Property has no landlord linked. Receipt cannot be posted.");
  }

  return {
    propertyId: unit.property,
    landlordId,
  };
};

const findFirstAccount = async (businessId, candidates = []) => {
  for (const candidate of candidates) {
    const query = { business: businessId };
    const and = [];

    if (candidate._id) {
      query._id = candidate._id;
    } else {
      if (candidate.type) and.push({ type: candidate.type });
      if (candidate.code) and.push({ code: candidate.code });
      if (candidate.group) and.push({ group: candidate.group });
      if (candidate.nameRegex) and.push({ name: { $regex: candidate.nameRegex, $options: "i" } });
      if (and.length > 0) query.$and = and;
    }

    const account = await ChartOfAccount.findOne(query).lean();
    if (account) return account;
  }

  return null;
};

const resolveCashbookAccount = async (businessId, payment) => {
  const cashbook = String(payment?.cashbook || "").trim();
  const paymentMethod = String(payment?.paymentMethod || "").trim();

  const exactByCashbook = cashbook
    ? await ChartOfAccount.findOne({
        business: businessId,
        name: { $regex: `^${cashbook.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
      }).lean()
    : null;

  if (exactByCashbook) return exactByCashbook;

  const candidates = [];

  if (/mpesa|m-pesa|mobile/i.test(cashbook) || paymentMethod === "mobile_money") {
    candidates.push(
      { nameRegex: "m-?pesa", type: "asset" },
      { nameRegex: "mobile money", type: "asset" }
    );
  }

  if (/bank/i.test(cashbook) || paymentMethod === "bank_transfer") {
    candidates.push({ nameRegex: "bank", type: "asset" });
  }

  if (/cash/i.test(cashbook) || paymentMethod === "cash") {
    candidates.push({ nameRegex: "^cash", type: "asset" });
  }

  candidates.push(
    { nameRegex: cashbook || "main cashbook", type: "asset" },
    { nameRegex: "main cashbook", type: "asset" },
    { nameRegex: "cashbook", type: "asset" },
    { nameRegex: "^cash$", type: "asset" }
  );

  const account = await findFirstAccount(businessId, candidates);
  if (!account) {
    throw new Error(
      `Cashbook account not found for '${cashbook || paymentMethod || "receipt"}'. Create the matching Chart of Account first.`
    );
  }

  return account;
};

const resolveCreditAccount = async (businessId, payment) => {
  switch (payment?.paymentType) {
    case "rent":
    case "utility": {
      const account = await findFirstAccount(businessId, [
        { code: "1200", type: "asset" },
        { nameRegex: "^tenant receivable", type: "asset" },
        { nameRegex: "accounts receivable", type: "asset" },
        { nameRegex: "receivable", type: "asset" },
      ]);

      if (!account) {
        throw new Error("Tenant receivable account not found. Receipt cannot reduce receivables correctly.");
      }
      return account;
    }

    case "deposit": {
      const account = await findFirstAccount(businessId, [
        { nameRegex: "deposit liability", type: "liability" },
        { nameRegex: "tenant deposit", type: "liability" },
        { nameRegex: "security deposit", type: "liability" },
      ]);

      if (!account) {
        throw new Error("Tenant deposit liability account not found. Deposit receipt cannot be posted correctly.");
      }
      return account;
    }

    case "late_fee":
    case "other":
    default: {
      const account = await findFirstAccount(businessId, [
        { nameRegex: "other income", type: "income" },
        { nameRegex: "late fee", type: "income" },
        { nameRegex: "miscellaneous income", type: "income" },
        { nameRegex: "rent income", type: "income" },
      ]);

      if (!account) {
        throw new Error("Income account for late fee/other receipt was not found.");
      }
      return account;
    }
  }
};

const shouldIncludeInLandlordStatement = (payment) => {
  // Operational landlord statement should see rent, utility and deposit events.
  return ["rent", "utility", "deposit"].includes(payment?.paymentType);
};

const recomputeTenantBalance = async (tenantId, businessId) => {
  if (!tenantId || !businessId) return;

  const [invoiceAgg, receiptAgg] = await Promise.all([
    TenantInvoice.aggregate([
      {
        $match: {
          business: new mongoose.Types.ObjectId(String(businessId)),
          tenant: new mongoose.Types.ObjectId(String(tenantId)),
          status: { $ne: "cancelled" },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
        },
      },
    ]),
    RentPayment.aggregate([
      {
        $match: {
          business: new mongoose.Types.ObjectId(String(businessId)),
          tenant: new mongoose.Types.ObjectId(String(tenantId)),
          ledgerType: "receipts",
          isConfirmed: true,
          isCancelled: { $ne: true },
          paymentType: { $in: ["rent", "utility"] },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
        },
      },
    ]),
  ]);

  const invoiceTotal = Number(invoiceAgg[0]?.total || 0);
  const receiptTotal = Number(receiptAgg[0]?.total || 0);
  const balance = invoiceTotal - receiptTotal;

  const tenant = await Tenant.findById(tenantId);
  if (!tenant) return;

  tenant.balance = balance;

  if (balance > 0 && tenant.status === "active") {
    tenant.status = "overdue";
  }
  if (balance <= 0 && tenant.status === "overdue") {
    tenant.status = "active";
  }

  await tenant.save();
};

const postReceiptJournal = async (payment, actorId) => {
  const amount = Math.abs(Number(payment.amount || 0));
  if (amount <= 0) {
    throw new Error("Receipt amount must be greater than zero for ledger posting.");
  }

  const { propertyId, landlordId } = await resolvePropertyAndLandlord(payment);
  const cashbookAccount = await resolveCashbookAccount(payment.business, payment);
  const creditAccount = await resolveCreditAccount(payment.business, payment);

  const category = getReceiptStatementCategory(payment);
  const receiver = payment?.paidDirectToLandlord ? "landlord" : "manager";
  const { start, end } = getStatementPeriodFromPayment(payment);
  const txDate = normalizeDate(payment.paymentDate);
  const journalGroupId = new mongoose.Types.ObjectId();
  const includeInStatement = shouldIncludeInLandlordStatement(payment);

  const statementOrOperationalLeg = await postEntry({
    business: payment.business,
    property: propertyId,
    landlord: landlordId,
    tenant: payment.tenant || null,
    unit: payment.unit || null,
    sourceTransactionType: "rent_payment",
    sourceTransactionId: String(payment._id),
    transactionDate: txDate,
    statementPeriodStart: start,
    statementPeriodEnd: end,
    category,
    amount,
    direction: "credit",
    debit: 0,
    credit: amount,
    accountId: creditAccount._id,
    journalGroupId,
    payer: "tenant",
    receiver,
    notes: `Receipt ${payment.receiptNumber || payment.referenceNumber || payment._id}`,
    metadata: {
      includeInLandlordStatement: includeInStatement,
      includeInCategoryTotals: includeInStatement,
      postingRole: getCreditPostingRole(payment.paymentType),
      paymentType: payment.paymentType,
      paymentMethod: payment.paymentMethod,
      cashbook: payment.cashbook || "Main Cashbook",
      paidDirectToLandlord: !!payment.paidDirectToLandlord,
      ledgerType: "receipts",
      receiptNumber: payment.receiptNumber || null,
      referenceNumber: payment.referenceNumber || null,
    },
    createdBy: actorId,
    approvedBy: actorId,
    approvedAt: new Date(),
    status: "approved",
  });

  const cashLeg = await postEntry({
    business: payment.business,
    property: propertyId,
    landlord: landlordId,
    tenant: payment.tenant || null,
    unit: payment.unit || null,
    sourceTransactionType: "rent_payment",
    sourceTransactionId: String(payment._id),
    transactionDate: txDate,
    statementPeriodStart: start,
    statementPeriodEnd: end,
    category: "ADJUSTMENT",
    amount,
    direction: "debit",
    debit: amount,
    credit: 0,
    accountId: cashbookAccount._id,
    journalGroupId,
    payer: "tenant",
    receiver,
    notes: `Cashbook leg for receipt ${payment.receiptNumber || payment.referenceNumber || payment._id}`,
    metadata: {
      includeInLandlordStatement: false,
      includeInCategoryTotals: false,
      postingRole: "cashbook",
      paymentType: payment.paymentType,
      paymentMethod: payment.paymentMethod,
      cashbook: payment.cashbook || "Main Cashbook",
      paidDirectToLandlord: !!payment.paidDirectToLandlord,
      ledgerType: "receipts",
      receiptNumber: payment.receiptNumber || null,
      referenceNumber: payment.referenceNumber || null,
      offsetOfEntryId: String(statementOrOperationalLeg._id),
    },
    createdBy: actorId,
    approvedBy: actorId,
    approvedAt: new Date(),
    status: "approved",
  });

  payment.journalGroupId = journalGroupId;
  payment.ledgerEntries = [statementOrOperationalLeg._id, cashLeg._id];
  payment.postingStatus = "posted";
  payment.postingError = null;
  await payment.save();

  return {
    journalGroupId,
    entries: [statementOrOperationalLeg, cashLeg],
  };
};

const reverseAllLedgerEntriesForPayment = async (payment, userId, reason) => {
  const originalEntries = await FinancialLedgerEntry.find({
    sourceTransactionType: "rent_payment",
    sourceTransactionId: String(payment._id),
    status: "approved",
    category: { $ne: "REVERSAL" },
  });

  if (!originalEntries.length) {
    return [];
  }

  const reversalResults = [];
  for (const entry of originalEntries) {
    if (entry.reversedByEntry || entry.status === "reversed") {
      continue;
    }

    const result = await postReversal({
      entryId: entry._id,
      reason: reason || "Payment reversed",
      userId,
    });

    reversalResults.push(result.reversalEntry);
  }

  return reversalResults;
};

export const createPayment = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId || !isValidObjectId(businessId)) {
      return res.status(400).json({
        success: false,
        message: "Valid business is required to create a receipt.",
      });
    }

    const isConfirmedOnCreate = req.body?.isConfirmed === true;
    const refNumber = String(req.body?.referenceNumber || "").trim();

    if (!refNumber) {
      return res.status(400).json({
        success: false,
        message: "Reference number is required for tenant receipts.",
      });
    }

    let receiptNumber = req.body?.receiptNumber?.trim();
    if (!receiptNumber) {
      receiptNumber = await generateReceiptNumber(businessId);
    }

    let actorUserId = null;
    if (isConfirmedOnCreate) {
      try {
        actorUserId = await resolveActorUserId({
          req,
          business: businessId,
          fallbackUserId: req.body?.confirmedBy || req.body?.createdBy || null,
        });
      } catch (actorError) {
        return res.status(400).json({ success: false, message: actorError.message });
      }
    }

    const payment = new RentPayment({
      ...req.body,
      ledgerType: "receipts",
      referenceNumber: refNumber,
      receiptNumber,
      bankingDate: req.body?.bankingDate || req.body?.paymentDate,
      recordDate: req.body?.recordDate || new Date(),
      business: businessId,
      isConfirmed: isConfirmedOnCreate,
      confirmedBy: isConfirmedOnCreate ? actorUserId : null,
      confirmedAt: isConfirmedOnCreate ? new Date() : null,
      postingStatus: "unposted",
      postingError: null,
      ledgerEntries: [],
    });

    const savedPayment = await payment.save();

    if (savedPayment.isConfirmed) {
      try {
        const posting = await postReceiptJournal(savedPayment, actorUserId);
        await recomputeTenantBalance(savedPayment.tenant, savedPayment.business);
        await aggregateChartOfAccountBalances(
          savedPayment.business,
          posting.entries.map((entry) => entry.accountId)
        );
      } catch (postingError) {
        await RentPayment.findByIdAndUpdate(savedPayment._id, {
          $set: {
            isConfirmed: false,
            confirmedBy: null,
            confirmedAt: null,
            postingStatus: "failed",
            postingError: postingError.message || "Ledger posting failed on create",
          },
        });

        return res.status(500).json({
          success: false,
          message: `Receipt was saved but confirmation posting failed: ${postingError.message}`,
        });
      }
    }

    emitToCompany(businessId, "payment:new", savedPayment);

    const populated = await RentPayment.findById(savedPayment._id)
      .populate("tenant", "name email phone")
      .populate("unit", "unitNumber property")
      .populate("confirmedBy", "surname otherNames email")
      .populate("ledgerEntries");

    return res.status(200).json(populated);
  } catch (err) {
    return next(err);
  }
};

export const getPayments = async (req, res, next) => {
  const { tenant, unit, month, year, paymentType, ledger } = req.query;

  try {
    const business =
      req.user.isSystemAdmin && req.query.business ? req.query.business : req.user.company;

    const filter = {
      business,
      ledgerType: "receipts",
    };

    if (tenant) filter.tenant = tenant;
    if (unit) filter.unit = unit;
    if (month) filter.month = parseInt(month, 10);
    if (year) filter.year = parseInt(year, 10);
    if (paymentType) filter.paymentType = paymentType;
    if (ledger && ledger === "receipts") filter.ledgerType = "receipts";

    const payments = await populateReceiptQuery(
      RentPayment.find(filter).sort({ paymentDate: -1, createdAt: -1 })
    );

    return res.status(200).json(payments);
  } catch (err) {
    return next(err);
  }
};

export const getPayment = async (req, res, next) => {
  try {
    const payment = await populateReceiptQuery(RentPayment.findById(req.params.id));

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    return res.status(200).json(payment);
  } catch (err) {
    return next(err);
  }
};

export const updatePayment = async (req, res, next) => {
  try {
    const payment = await RentPayment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    if (payment.isConfirmed && payment.postingStatus === "posted") {
      return res.status(400).json({
        success: false,
        message: "Confirmed and posted receipts cannot be edited directly. Reverse and recreate instead.",
      });
    }

    const referenceNumber = String(req.body?.referenceNumber || payment.referenceNumber || "").trim();
    if (!referenceNumber) {
      return res.status(400).json({
        success: false,
        message: "Reference number is required for tenant receipts.",
      });
    }

    const safeUpdate = {
      ...req.body,
      referenceNumber,
      ledgerType: "receipts",
    };

    delete safeUpdate.business;
    delete safeUpdate.ledgerEntries;
    delete safeUpdate.journalGroupId;
    delete safeUpdate.postingStatus;
    delete safeUpdate.postingError;
    delete safeUpdate.reversalEntry;
    delete safeUpdate.reversalOf;

    const updatedPayment = await populateReceiptQuery(
      RentPayment.findByIdAndUpdate(
        req.params.id,
        { $set: safeUpdate },
        { new: true }
      )
    );

    return res.status(200).json(updatedPayment);
  } catch (err) {
    return next(err);
  }
};

export const confirmPayment = async (req, res, next) => {
  try {
    const existingPayment = await RentPayment.findById(req.params.id);
    if (!existingPayment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    if (existingPayment.isConfirmed && existingPayment.postingStatus === "posted") {
      const populated = await populateReceiptQuery(RentPayment.findById(existingPayment._id));

      return res.status(200).json(populated);
    }

    let actorUserId;
    try {
      actorUserId = await resolveActorUserId({
        req,
        business: existingPayment.business,
        fallbackUserId: req.body?.confirmedBy || existingPayment.confirmedBy || null,
      });
    } catch (actorError) {
      return res.status(400).json({ success: false, message: actorError.message });
    }

    existingPayment.isConfirmed = true;
    existingPayment.confirmedBy = actorUserId;
    existingPayment.confirmedAt = new Date();
    existingPayment.postingStatus = "unposted";
    existingPayment.postingError = null;
    existingPayment.ledgerType = "receipts";
    await existingPayment.save();

    try {
      const posting = await postReceiptJournal(existingPayment, actorUserId);
      await recomputeTenantBalance(existingPayment.tenant, existingPayment.business);
      await aggregateChartOfAccountBalances(
        existingPayment.business,
        posting.entries.map((entry) => entry.accountId)
      );
    } catch (postingError) {
      existingPayment.isConfirmed = false;
      existingPayment.confirmedBy = null;
      existingPayment.confirmedAt = null;
      existingPayment.postingStatus = "failed";
      existingPayment.postingError = postingError.message || "Ledger posting failed on confirm";
      await existingPayment.save();

      return res.status(500).json({
        success: false,
        message: `Receipt confirmation failed because ledger posting did not complete: ${postingError.message}`,
      });
    }

    const populated = await RentPayment.findById(existingPayment._id)
      .populate("tenant", "name email phone")
      .populate("unit", "unitNumber property")
      .populate("confirmedBy", "surname otherNames email")
      .populate("ledgerEntries");

    return res.status(200).json(populated);
  } catch (err) {
    return next(err);
  }
};

export const unconfirmPayment = async (req, res, next) => {
  try {
    const payment = await RentPayment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    if (!payment.isConfirmed) {
      return res.status(400).json({
        success: false,
        message: "This payment is not confirmed.",
      });
    }

    if (payment.postingStatus === "posted" || (Array.isArray(payment.ledgerEntries) && payment.ledgerEntries.length > 0)) {
      return res.status(400).json({
        success: false,
        message:
          "This receipt has already been posted to the ledger. Use reversal instead of unconfirming it.",
      });
    }

    payment.isConfirmed = false;
    payment.confirmedBy = null;
    payment.confirmedAt = null;
    payment.postingStatus = "unposted";
    payment.postingError = null;
    await payment.save();

    await recomputeTenantBalance(payment.tenant, payment.business);

    return res.status(200).json({
      success: true,
      message: "Payment unconfirmed successfully.",
      data: payment,
    });
  } catch (err) {
    return next(err);
  }
};

export const deletePayment = async (req, res, next) => {
  try {
    const payment = await RentPayment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    if (payment.isConfirmed || payment.postingStatus === "posted") {
      return res.status(400).json({
        success: false,
        message: "Cannot delete a confirmed/posted receipt. Reverse it instead.",
      });
    }

    await RentPayment.findByIdAndDelete(req.params.id);

    return res.status(200).json({ message: "Payment deleted successfully" });
  } catch (err) {
    return next(err);
  }
};

export const getPaymentSummary = async (req, res, next) => {
  const { business, month, year } = req.query;

  try {
    const scopedBusiness =
      req.user.isSystemAdmin && business ? business : req.user.company;

    const filter = {
      business: scopedBusiness,
      ledgerType: "receipts",
      isConfirmed: true,
      isCancelled: { $ne: true },
    };

    if (month) filter.month = parseInt(month, 10);
    if (year) filter.year = parseInt(year, 10);

    const payments = await RentPayment.find(filter);

    const totalRent = payments
      .filter((p) => p.paymentType === "rent")
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const totalDeposits = payments
      .filter((p) => p.paymentType === "deposit")
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const totalUtilities = payments
      .filter((p) => p.paymentType === "utility")
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const totalLateFees = payments
      .filter((p) => p.paymentType === "late_fee")
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    return res.status(200).json({
      totalPayments: payments.length,
      totalAmount: totalRent + totalDeposits + totalUtilities + totalLateFees,
      breakdown: {
        rent: totalRent,
        deposits: totalDeposits,
        utilities: totalUtilities,
        lateFees: totalLateFees,
      },
      month: month || "All",
      year: year || "All",
    });
  } catch (err) {
    return next(err);
  }
};

export const reversePayment = async (req, res, next) => {
  try {
    const payment = await RentPayment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    if (!payment.isConfirmed) {
      return res.status(400).json({
        success: false,
        message: "Only confirmed receipts can be reversed.",
      });
    }

    if (payment.isReversed) {
      return res.status(400).json({
        success: false,
        message: "Receipt is already reversed.",
      });
    }

    const reason = req.body?.reason || "Receipt reversed";
    const businessId = payment.business || resolveBusinessId(req);

    let reversedBy;
    try {
      reversedBy = await resolveActorUserId({
        req,
        business: businessId,
        fallbackUserId: payment.confirmedBy || payment.createdBy || null,
      });
    } catch (actorError) {
      return res.status(400).json({ success: false, message: actorError.message });
    }

    const reversalReceiptNumber = await generateReceiptNumber(businessId);
    const reversalRef = `REV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const reversalPayload = {
      tenant: payment.tenant,
      unit: payment.unit,
      amount: -Math.abs(Number(payment.amount || 0)),
      paymentType: payment.paymentType,
      paymentDate: new Date(),
      bankingDate: new Date(),
      recordDate: new Date(),
      dueDate: payment.dueDate || new Date(),
      referenceNumber: reversalRef,
      description: `Reversal of ${payment.receiptNumber || payment.referenceNumber}. ${reason}`,
      isConfirmed: true,
      confirmedBy: reversedBy,
      confirmedAt: new Date(),
      paymentMethod: payment.paymentMethod,
      receiptNumber: reversalReceiptNumber,
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
      business: businessId,
      ledgerType: "receipts",
      reversalOf: payment._id,
      cashbook: payment.cashbook,
      paidDirectToLandlord: payment.paidDirectToLandlord,
      postingStatus: "unposted",
      postingError: null,
      ledgerEntries: [],
    };

    const reversalEntry = await new RentPayment(reversalPayload).save();

    try {
      const reversalEntries = await reverseAllLedgerEntriesForPayment(payment, reversedBy, reason);

      payment.isReversed = true;
      payment.reversedAt = new Date();
      payment.reversedBy = reversedBy;
      payment.reversalReason = reason;
      payment.reversalEntry = reversalEntry._id;
      payment.postingStatus = "reversed";
      await payment.save();

      reversalEntry.postingStatus = "posted";
      reversalEntry.postingError = null;
      await reversalEntry.save();

      await recomputeTenantBalance(payment.tenant, payment.business);

      const touchedAccountIds = reversalEntries
        .map((entry) => entry?.accountId)
        .filter(Boolean);

      if (touchedAccountIds.length > 0) {
        await aggregateChartOfAccountBalances(payment.business, touchedAccountIds);
      }
    } catch (reversalError) {
      reversalEntry.isCancelled = true;
      reversalEntry.cancelledAt = new Date();
      reversalEntry.cancelledBy = reversedBy;
      reversalEntry.cancellationReason = `Auto-cancelled because reversal posting failed: ${reversalError.message}`;
      reversalEntry.postingStatus = "failed";
      reversalEntry.postingError = reversalError.message || "Ledger reversal failed";
      await reversalEntry.save();

      return res.status(500).json({
        success: false,
        message: `Receipt reversal failed because ledger reversal did not complete: ${reversalError.message}`,
      });
    }

    emitToCompany(businessId, "payment:reversed", {
      paymentId: payment._id,
      reversalId: reversalEntry._id,
    });

    const populatedOriginal = await RentPayment.findById(payment._id)
      .populate("tenant", "name email phone")
      .populate("unit", "unitNumber")
      .populate("reversalEntry")
      .populate("ledgerEntries");

    const populatedReversal = await RentPayment.findById(reversalEntry._id)
      .populate("tenant", "name email phone")
      .populate("unit", "unitNumber");

    return res.status(200).json({
      success: true,
      message: "Receipt reversed successfully",
      data: {
        original: populatedOriginal,
        reversal: populatedReversal,
      },
    });
  } catch (err) {
    return next(err);
  }
};

export const cancelReversal = async (req, res, next) => {
  try {
    const payment = await RentPayment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    if (!payment.isReversed || !payment.reversalEntry) {
      return res.status(400).json({
        success: false,
        message: "Receipt does not have an active reversal.",
      });
    }

    return res.status(400).json({
      success: false,
      message:
        "Cancellation of posted reversals is blocked for audit safety. Create a new correcting receipt instead.",
    });
  } catch (err) {
    return next(err);
  }
};
