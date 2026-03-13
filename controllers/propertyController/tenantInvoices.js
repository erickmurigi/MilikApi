import mongoose from "mongoose";
import TenantInvoice from "../../models/TenantInvoice.js";
import Tenant from "../../models/Tenant.js";
import User from "../../models/User.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import RentPayment from "../../models/RentPayment.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import { postEntry, postReversal } from "../../services/ledgerPostingService.js";
import { aggregateChartOfAccountBalances } from "../../services/chartAccountAggregationService.js";
import { ensureSystemChartOfAccounts } from "../../services/chartOfAccountsService.js";

const escapeRegExp = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const normalizeDate = (value, fallback = new Date()) => {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback) : date;
};

const buildStatementPeriod = (invoiceDate) => {
  const dt = normalizeDate(invoiceDate, new Date());
  const year = dt.getFullYear();
  const month = dt.getMonth();
  const start = new Date(year, month, 1, 0, 0, 0, 0);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
  return { start, end };
};

const findFirstAccount = async (businessId, candidates = []) => {
  for (const candidate of candidates) {
    const query = { business: businessId };

    if (candidate._id) {
      query._id = candidate._id;
    } else {
      const and = [];
      if (candidate.type) and.push({ type: candidate.type });
      if (candidate.code) and.push({ code: candidate.code });
      if (candidate.nameRegex) and.push({ name: { $regex: candidate.nameRegex, $options: "i" } });
      if (candidate.group) and.push({ group: candidate.group });
      if (and.length > 0) query.$and = and;
    }

    const account = await ChartOfAccount.findOne(query).lean();
    if (account) return account;
  }

  return null;
};

const resolveTenantReceivableAccount = async (businessId) => {
  const account = await findFirstAccount(businessId, [
    { code: "1200", type: "asset" },
    { nameRegex: "^tenant receivable", type: "asset" },
    { nameRegex: "accounts receivable", type: "asset" },
    { nameRegex: "receivable", type: "asset" },
  ]);

  if (!account) {
    throw new Error(
      "Tenant receivable account not found. Create a Chart of Account such as 'Tenant Receivables' before posting invoices."
    );
  }

  return account;
};

const resolveActorUserId = async ({ req, business, bodyCreatedBy }) => {
  const candidates = [bodyCreatedBy, req.user?.id, req.user?._id].filter(Boolean);

  for (const candidate of candidates) {
    if (isValidObjectId(candidate)) {
      const existingUser = await User.findById(candidate).select("_id company isActive").lean();
      if (existingUser && existingUser.isActive !== false) {
        return String(existingUser._id);
      }
    }
  }

  if (!business || !isValidObjectId(business)) {
    throw new Error("Unable to resolve createdBy user because business is missing or invalid.");
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
    "No valid company user could be resolved for createdBy. Create at least one real user under this company, or submit a valid User ObjectId."
  );
};

const recomputeTenantBalance = async (tenantId, businessId) => {
  if (!tenantId || !businessId) return;

  const [invoiceAgg, receiptAgg] = await Promise.all([
    TenantInvoice.aggregate([
      {
        $match: {
          business: new mongoose.Types.ObjectId(String(businessId)),
          tenant: new mongoose.Types.ObjectId(String(tenantId)),
          status: { $nin: ["cancelled", "reversed"] },
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

const postInvoiceJournal = async ({ invoice, createdBy, incomeAccountId }) => {
  const receivableAccount = await resolveTenantReceivableAccount(invoice.business);
  const incomeAccount = await ChartOfAccount.findOne({
    _id: incomeAccountId,
    business: invoice.business,
  }).lean();

  if (!incomeAccount) {
    throw new Error("Selected invoice chart account was not found for this business.");
  }

  const journalGroupId = new mongoose.Types.ObjectId();
  const { start, end } = buildStatementPeriod(invoice.invoiceDate);
  const txDate = normalizeDate(invoice.invoiceDate);
  const amount = Math.abs(Number(invoice.amount || 0));

  const receivableLeg = await postEntry({
    business: invoice.business,
    property: invoice.property,
    landlord: invoice.landlord,
    tenant: invoice.tenant,
    unit: invoice.unit,
    sourceTransactionType: "invoice",
    sourceTransactionId: String(invoice._id),
    transactionDate: txDate,
    statementPeriodStart: start,
    statementPeriodEnd: end,
    category: invoice.category,
    amount,
    direction: "debit",
    debit: amount,
    credit: 0,
    accountId: receivableAccount._id,
    journalGroupId,
    payer: "tenant",
    receiver: "manager",
    notes: `Invoice ${invoice.invoiceNumber}`,
    metadata: {
      includeInLandlordStatement: true,
      includeInCategoryTotals: true,
      postingRole: "tenant_receivable",
      invoiceNumber: invoice.invoiceNumber,
      invoiceCategory: invoice.category,
    },
    createdBy,
    approvedBy: createdBy,
    approvedAt: new Date(),
    status: "approved",
  });

  const incomeLeg = await postEntry({
    business: invoice.business,
    property: invoice.property,
    landlord: invoice.landlord,
    tenant: invoice.tenant,
    unit: invoice.unit,
    sourceTransactionType: "invoice",
    sourceTransactionId: String(invoice._id),
    transactionDate: txDate,
    statementPeriodStart: start,
    statementPeriodEnd: end,
    category: invoice.category,
    amount,
    direction: "credit",
    debit: 0,
    credit: amount,
    accountId: incomeAccount._id,
    journalGroupId,
    payer: "tenant",
    receiver: "manager",
    notes: `Invoice income leg ${invoice.invoiceNumber}`,
    metadata: {
      includeInLandlordStatement: false,
      includeInCategoryTotals: false,
      postingRole: "income_or_charge",
      invoiceNumber: invoice.invoiceNumber,
      invoiceCategory: invoice.category,
      offsetOfEntryId: String(receivableLeg._id),
    },
    createdBy,
    approvedBy: createdBy,
    approvedAt: new Date(),
    status: "approved",
  });

  return {
    journalGroupId,
    entries: [receivableLeg, incomeLeg],
  };
};

export const createTenantInvoice = async (req, res) => {
  try {
    const {
      business,
      property,
      landlord,
      tenant,
      unit,
      invoiceNumber,
      category,
      amount,
      description,
      invoiceDate,
      dueDate,
      createdBy,
    } = req.body;

    const chartAccountId = req.body.chartAccountId || null;

    if (
      !business ||
      !property ||
      !landlord ||
      !tenant ||
      !unit ||
      !invoiceNumber ||
      !category ||
      !invoiceDate ||
      !dueDate
    ) {
      return res.status(400).json({
        error: "Missing required invoice fields.",
      });
    }

    if (!chartAccountId) {
      return res.status(400).json({
        error: "Chart of Account is required for invoice posting.",
      });
    }

    if (Number(amount) <= 0) {
      return res.status(400).json({
        error: "Amount must be positive.",
      });
    }

    const normalizedInvoiceDate = normalizeDate(invoiceDate);
    const normalizedDueDate = normalizeDate(dueDate, normalizedInvoiceDate);

    if (normalizedDueDate < normalizedInvoiceDate) {
      return res.status(400).json({
        error: "Due date must be after invoice date.",
      });
    }

    await ensureSystemChartOfAccounts(business);

    const normalizedInvoiceNumber = String(invoiceNumber).trim();

    const duplicate = await TenantInvoice.findOne({
      business,
      invoiceNumber: {
        $regex: `^${escapeRegExp(normalizedInvoiceNumber)}$`,
        $options: "i",
      },
    }).lean();

    if (duplicate) {
      return res.status(409).json({
        error: "Invoice number already exists for this business. Please use a unique number.",
      });
    }

    let actorUserId;
    try {
      actorUserId = await resolveActorUserId({
        req,
        business,
        bodyCreatedBy: createdBy,
      });
    } catch (actorError) {
      return res.status(400).json({
        error: actorError.message,
      });
    }

    const invoice = await TenantInvoice.create({
      business,
      property,
      landlord,
      tenant,
      unit,
      invoiceNumber: normalizedInvoiceNumber,
      category,
      amount: Math.abs(Number(amount)),
      description: description || "",
      invoiceDate: normalizedInvoiceDate,
      dueDate: normalizedDueDate,
      status: "pending",
      createdBy: actorUserId,
      chartAccount: chartAccountId,
      postingStatus: "unposted",
      postingError: null,
      ledgerEntries: [],
    });

    try {
      const posting = await postInvoiceJournal({
        invoice,
        createdBy: actorUserId,
        incomeAccountId: chartAccountId,
      });

      invoice.journalGroupId = posting.journalGroupId;
      invoice.ledgerEntries = posting.entries.map((entry) => entry._id);
      invoice.postingStatus = "posted";
      invoice.postingError = null;
      invoice.status = "pending";
      await invoice.save();

      await aggregateChartOfAccountBalances(
        invoice.business,
        posting.entries.map((entry) => entry.accountId)
      );

      await recomputeTenantBalance(invoice.tenant, invoice.business);

      const populated = await TenantInvoice.findById(invoice._id)
        .populate("chartAccount", "code name type")
        .populate("ledgerEntries")
        .populate("createdBy", "surname otherNames email profile");

      return res.status(201).json(populated);
    } catch (postingError) {
      invoice.postingStatus = "failed";
      invoice.postingError = postingError.message || "Ledger posting failed";
      await invoice.save();

      return res.status(500).json({
        error: `Invoice created but ledger posting failed: ${postingError.message}`,
        invoiceId: invoice._id,
      });
    }
  } catch (error) {
    console.error("TenantInvoice creation error:", error);
    return res.status(500).json({
      error: `Failed to create invoice. ${error.message}`,
    });
  }
};

export const deleteTenantInvoice = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(String(id || ""))) {
      return res.status(400).json({
        error: "Invalid invoice id.",
      });
    }

    const invoice = await TenantInvoice.findById(id);

    if (!invoice) {
      return res.status(404).json({
        error: "Invoice not found.",
      });
    }

    if (["paid", "partially_paid"].includes(String(invoice.status || "").toLowerCase())) {
      return res.status(400).json({
        error: "Paid or partially paid invoices cannot be deleted. Reverse receipts first.",
      });
    }

    let actorUserId;
    try {
      actorUserId = await resolveActorUserId({
        req,
        business: invoice.business,
        bodyCreatedBy: invoice.createdBy,
      });
    } catch (actorError) {
      return res.status(400).json({
        error: actorError.message,
      });
    }

    const originalEntries = await FinancialLedgerEntry.find({
      business: invoice.business,
      sourceTransactionType: "invoice",
      sourceTransactionId: String(invoice._id),
      status: "approved",
      category: { $ne: "REVERSAL" },
    });

    const touchedAccountIds = new Set();

    for (const entry of originalEntries) {
      if (entry?.accountId) {
        touchedAccountIds.add(String(entry.accountId));
      }

      if (!entry.reversedByEntry && entry.status !== "reversed") {
        const reversal = await postReversal({
          entryId: entry._id,
          reason: `Invoice ${invoice.invoiceNumber} deleted`,
          userId: actorUserId,
        });

        if (reversal?.reversalEntry?.accountId) {
          touchedAccountIds.add(String(reversal.reversalEntry.accountId));
        }
      }
    }

    await TenantInvoice.findByIdAndDelete(invoice._id);

    await recomputeTenantBalance(invoice.tenant, invoice.business);

    if (touchedAccountIds.size > 0) {
      await aggregateChartOfAccountBalances(invoice.business, Array.from(touchedAccountIds));
    }

    return res.status(200).json({
      success: true,
      message: "Invoice deleted and ledger reversed successfully.",
      deletedInvoiceId: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
    });
  } catch (error) {
    console.error("Delete tenant invoice error:", error);
    return res.status(500).json({
      error: `Failed to delete invoice. ${error.message}`,
    });
  }
};