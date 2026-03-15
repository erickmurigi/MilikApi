import {
  getOpeningBalance,
  getEntriesForStatement,
  getLedgerTotalsByCategory,
} from "./ledgerQueryService.js";
import Property from "../models/Property.js";
import Unit from "../models/Unit.js";
import Tenant from "../models/Tenant.js";
import TenantInvoice from "../models/TenantInvoice.js";
import RentPayment from "../models/RentPayment.js";
import ExpenseProperty from "../models/ExpenseProperty.js";

const toAbs = (value) => Math.abs(Number(value || 0));
const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;
const toDate = (value) => {
  if (!value) return new Date();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

const STATEMENT_CATEGORIES = [
  "RENT_CHARGE",
  "UTILITY_CHARGE",
  "OPENING_BALANCE_BF",
  "RENT_RECEIPT_MANAGER",
  "RENT_RECEIPT_LANDLORD",
  "UTILITY_RECEIPT_MANAGER",
  "UTILITY_RECEIPT_LANDLORD",
  "DEPOSIT_RECEIVED",
  "DEPOSIT_REFUNDED",
  "DEPOSIT_APPLIED",
  "COMMISSION_CHARGE",
  "EXPENSE_DEDUCTION",
  "RECURRING_DEDUCTION",
  "ADVANCE_TO_LANDLORD",
  "ADVANCE_RECOVERY",
  "ADJUSTMENT",
  "WRITE_OFF",
];

const normalizeId = (value) => {
  if (!value) return "";
  if (typeof value === "object") return String(value._id || value.id || "");
  return String(value);
};

const monthName = (date) => date.toLocaleDateString("en-KE", { month: "long" });

const classifyUtilityBucket = (source) => {
  const text = String(source || "").toLowerCase();
  if (/water|sewer|borehole/.test(text)) return "water";
  if (/garbage|refuse|trash|waste|service charge|cleaning/.test(text)) return "garbage";
  return "garbage";
};

const getReceiptRentAmount = (payment) => {
  const breakdownRent = Number(payment?.breakdown?.rent || 0);
  if (breakdownRent > 0) return breakdownRent;
  return String(payment?.paymentType || "").toLowerCase() === "rent"
    ? Number(payment?.amount || 0)
    : 0;
};

const getReceiptUtilitySplits = (payment) => {
  const result = { garbage: 0, water: 0 };

  if (Array.isArray(payment?.breakdown?.utilities) && payment.breakdown.utilities.length > 0) {
    payment.breakdown.utilities.forEach((item) => {
      const bucket = classifyUtilityBucket(item?.name || item?.utilityLabel || payment?.description);
      result[bucket] += Number(item?.amount || 0);
    });
    return result;
  }

  if (String(payment?.paymentType || "").toLowerCase() === "utility") {
    const bucket = classifyUtilityBucket(payment?.description || payment?.referenceNumber || "utility");
    result[bucket] += Number(payment?.amount || 0);
  }

  return result;
};

const buildScheduleWorkspace = async ({ propertyId, landlordId, periodStart, periodEnd, property }) => {
  const businessId = property?.business;

  const [units, tenants, invoices, priorInvoices, receipts, priorReceipts, expenses] = await Promise.all([
    Unit.find({ property: propertyId }).sort({ unitNumber: 1 }).lean(),
    Tenant.find({ business: businessId, status: { $nin: ["inactive", "moved_out", "evicted"] } })
      .populate("unit", "unitNumber property rent")
      .lean(),
    TenantInvoice.find({
      business: businessId,
      property: propertyId,
      landlord: landlordId,
      status: { $nin: ["cancelled", "reversed"] },
      invoiceDate: { $gte: periodStart, $lte: periodEnd },
    }).lean(),
    TenantInvoice.find({
      business: businessId,
      property: propertyId,
      landlord: landlordId,
      status: { $nin: ["cancelled", "reversed"] },
      invoiceDate: { $lt: periodStart },
    }).lean(),
    RentPayment.find({
      business: businessId,
      ledgerType: "receipts",
      isConfirmed: true,
      isCancelled: { $ne: true },
      reversalOf: null,
      paymentDate: { $gte: periodStart, $lte: periodEnd },
    })
      .populate({ path: "unit", select: "unitNumber property rent" })
      .populate("tenant", "name tenantCode idNumber rent")
      .lean(),
    RentPayment.find({
      business: businessId,
      ledgerType: "receipts",
      isConfirmed: true,
      isCancelled: { $ne: true },
      reversalOf: null,
      paymentDate: { $lt: periodStart },
    })
      .populate({ path: "unit", select: "unitNumber property rent" })
      .populate("tenant", "name tenantCode idNumber rent")
      .lean(),
    ExpenseProperty.find({
      business: businessId,
      property: propertyId,
      date: { $gte: periodStart, $lte: periodEnd },
    })
      .sort({ date: 1, createdAt: 1 })
      .lean(),
  ]);

  const scopedTenants = tenants.filter(
    (tenant) => normalizeId(tenant?.unit?.property) === normalizeId(propertyId)
  );

  const tenantByUnitId = new Map();
  scopedTenants.forEach((tenant) => {
    const unitId = normalizeId(tenant?.unit?._id || tenant?.unit);
    if (!unitId || tenantByUnitId.has(unitId)) return;
    tenantByUnitId.set(unitId, tenant);
  });

  const scopedReceipts = receipts.filter(
    (payment) => normalizeId(payment?.unit?.property) === normalizeId(propertyId)
  );
  const scopedPriorReceipts = priorReceipts.filter(
    (payment) => normalizeId(payment?.unit?.property) === normalizeId(propertyId)
  );

  const rows = units.map((unit) => {
    const unitId = normalizeId(unit?._id);
    const tenant = tenantByUnitId.get(unitId) || null;
    const tenantId = normalizeId(tenant?._id);

    const row = {
      unitId,
      tenantId,
      unit: unit?.unitNumber || "-",
      accountNo: tenant?.tenantCode || tenant?.idNumber || "",
      tenantName: tenant?.name || "VACANT",
      perMonth: round2(Number(tenant?.rent || unit?.rent || 0)),
      openingBalance: 0,
      invoicedRent: 0,
      invoicedGarbage: 0,
      invoicedWater: 0,
      paidRent: 0,
      paidGarbage: 0,
      paidWater: 0,
      closingBalance: 0,
      paidDirectToLandlord: 0,
      paidToManager: 0,
      referenceNumbers: [],
    };

    const periodInvoices = invoices.filter((inv) => normalizeId(inv?.unit) === unitId);
    const beforeInvoices = priorInvoices.filter((inv) => normalizeId(inv?.unit) === unitId);
    const periodReceipts = scopedReceipts.filter((payment) => normalizeId(payment?.unit?._id || payment?.unit) === unitId);
    const beforeReceipts = scopedPriorReceipts.filter((payment) => normalizeId(payment?.unit?._id || payment?.unit) === unitId);

    beforeInvoices.forEach((invoice) => {
      row.openingBalance += Number(invoice?.amount || 0);
    });

    beforeReceipts.forEach((payment) => {
      row.openingBalance -= Number(payment?.amount || 0);
    });

    periodInvoices.forEach((invoice) => {
      const amount = Number(invoice?.amount || 0);
      if (String(invoice?.category || "").toUpperCase() === "RENT_CHARGE") {
        row.invoicedRent += amount;
      } else {
        const bucket = classifyUtilityBucket(invoice?.description || invoice?.invoiceNumber);
        if (bucket === "water") row.invoicedWater += amount;
        else row.invoicedGarbage += amount;
      }
    });

    periodReceipts.forEach((payment) => {
      const rentAmount = getReceiptRentAmount(payment);
      const utilitySplit = getReceiptUtilitySplits(payment);
      row.paidRent += rentAmount;
      row.paidGarbage += Number(utilitySplit.garbage || 0);
      row.paidWater += Number(utilitySplit.water || 0);
      const amount = Number(payment?.amount || 0);
      if (payment?.paidDirectToLandlord) row.paidDirectToLandlord += amount;
      else row.paidToManager += amount;
      if (payment?.receiptNumber || payment?.referenceNumber) {
        row.referenceNumbers.push(payment.receiptNumber || payment.referenceNumber);
      }
    });

    row.openingBalance = round2(row.openingBalance);
    row.invoicedRent = round2(row.invoicedRent);
    row.invoicedGarbage = round2(row.invoicedGarbage);
    row.invoicedWater = round2(row.invoicedWater);
    row.paidRent = round2(row.paidRent);
    row.paidGarbage = round2(row.paidGarbage);
    row.paidWater = round2(row.paidWater);
    row.paidDirectToLandlord = round2(row.paidDirectToLandlord);
    row.paidToManager = round2(row.paidToManager);
    row.closingBalance = round2(
      row.openingBalance + row.invoicedRent + row.invoicedGarbage + row.invoicedWater - row.paidRent - row.paidGarbage - row.paidWater
    );

    return row;
  });

  const totals = rows.reduce(
    (acc, row) => {
      acc.perMonth += row.perMonth;
      acc.openingBalance += row.openingBalance;
      acc.invoicedRent += row.invoicedRent;
      acc.invoicedGarbage += row.invoicedGarbage;
      acc.invoicedWater += row.invoicedWater;
      acc.paidRent += row.paidRent;
      acc.paidGarbage += row.paidGarbage;
      acc.paidWater += row.paidWater;
      acc.closingBalance += row.closingBalance;
      acc.paidDirectToLandlord += row.paidDirectToLandlord;
      acc.paidToManager += row.paidToManager;
      return acc;
    },
    {
      perMonth: 0,
      openingBalance: 0,
      invoicedRent: 0,
      invoicedGarbage: 0,
      invoicedWater: 0,
      paidRent: 0,
      paidGarbage: 0,
      paidWater: 0,
      closingBalance: 0,
      paidDirectToLandlord: 0,
      paidToManager: 0,
    }
  );

  Object.keys(totals).forEach((key) => {
    totals[key] = round2(totals[key]);
  });

  const directLandlordExpenseRows = scopedReceipts
    .filter((payment) => !!payment?.paidDirectToLandlord)
    .map((payment) => ({
      date: payment?.paymentDate,
      description: `Tenant paid landlord directly${payment?.tenant?.name ? ` - ${payment.tenant.name}` : ""}${payment?.receiptNumber || payment?.referenceNumber ? ` (${payment.receiptNumber || payment.referenceNumber})` : ""}`,
      amount: round2(Number(payment?.amount || 0)),
      category: "direct_landlord_collection",
      sourceId: String(payment?._id),
    }));

  const expenseRows = [
    ...expenses.map((expense) => ({
      date: expense?.date,
      description: expense?.description || expense?.category || "Property expense",
      amount: round2(Number(expense?.amount || 0)),
      category: expense?.category || "other",
      sourceId: String(expense?._id),
    })),
    ...directLandlordExpenseRows,
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const commissionPercentage = Number(property?.commissionPercentage || 0);
  const recognitionBasis = String(property?.commissionRecognitionBasis || "received").toLowerCase();
  let commissionBase = totals.paidRent + directLandlordExpenseRows.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  if (recognitionBasis === "invoiced") commissionBase = totals.invoicedRent;
  if (recognitionBasis === "received_manager_only") commissionBase = rows.reduce((sum, row) => sum + Number(row.paidToManager || 0), 0);
  const commissionAmount = round2((commissionBase * commissionPercentage) / 100);

  const hardExpensesTotal = round2(expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const directLandlordTotal = round2(directLandlordExpenseRows.reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const totalDeductions = round2(hardExpensesTotal + directLandlordTotal + commissionAmount);
  const managerCollections = round2(rows.reduce((sum, row) => sum + Number(row.paidToManager || 0), 0));
  const netStatement = round2(managerCollections - totalDeductions);

  if (commissionAmount > 0) {
    expenseRows.push({
      date: periodEnd,
      description: `Management commission @ ${commissionPercentage}%`,
      amount: commissionAmount,
      category: "commission",
      sourceId: "commission",
    });
  }

  return {
    periodLabel: `${monthName(periodStart)} ${periodStart.getFullYear()}`,
    month: periodStart.getMonth() + 1,
    year: periodStart.getFullYear(),
    columns: {
      primary: [
        "unit",
        "accountNo",
        "tenantName",
        "perMonth",
        "openingBalance",
        "invoicedRent",
        "invoicedGarbage",
        "invoicedWater",
        "paidRent",
        "paidGarbage",
        "paidWater",
        "closingBalance",
      ],
    },
    rows,
    totals,
    expenseRows,
    summary: {
      landlordName:
        property?.landlords?.find((item) => normalizeId(item?.landlordId) === normalizeId(landlordId))?.name ||
        "",
      propertyName: property?.propertyName || property?.name || "",
      rentInvoiced: round2(totals.invoicedRent + totals.invoicedGarbage + totals.invoicedWater),
      managerCollections,
      directToLandlordCollections: directLandlordTotal,
      propertyExpenses: hardExpensesTotal,
      commissionPercentage: round2(commissionPercentage),
      commissionBasis: recognitionBasis,
      commissionAmount,
      totalDeductions,
      netStatement,
      isNegativeStatement: netStatement < 0,
      amountPayableByLandlordToManager: netStatement < 0 ? Math.abs(netStatement) : 0,
      amountPayableToLandlord: netStatement > 0 ? netStatement : 0,
      occupiedUnits: rows.filter((row) => row.tenantName !== "VACANT").length,
      vacantUnits: rows.filter((row) => row.tenantName === "VACANT").length,
    },
  };
};

export const generateLandlordStatement = async ({
  propertyId,
  landlordId,
  statementPeriodStart,
  statementPeriodEnd,
}) => {
  if (!propertyId || !landlordId || !statementPeriodStart || !statementPeriodEnd) {
    throw new Error(
      "generateLandlordStatement requires propertyId, landlordId, statementPeriodStart, and statementPeriodEnd"
    );
  }

  const periodStart = toDate(statementPeriodStart);
  const periodEnd = toDate(statementPeriodEnd);

  const openingBalance = await getOpeningBalance(propertyId, landlordId, periodStart);
  const rawEntries = await getEntriesForStatement(propertyId, landlordId, periodStart, periodEnd);
  const entries = rawEntries.sort((a, b) => {
    const dateA = new Date(a.transactionDate).getTime();
    const dateB = new Date(b.transactionDate).getTime();
    if (dateA !== dateB) return dateA - dateB;
    return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
  });

  const totalsResult = await getLedgerTotalsByCategory({
    propertyId,
    landlordId,
    periodStart,
    periodEnd,
  });

  const allTotalsByCategory = totalsResult.totalsByCategory || {};
  const categorySummary = STATEMENT_CATEGORIES.reduce((acc, category) => {
    acc[category] = allTotalsByCategory[category] || {
      count: 0,
      totalAmount: 0,
      totalDebit: 0,
      totalCredit: 0,
    };
    return acc;
  }, {});

  const property = await Property.findById(propertyId)
    .select("business propertyName name commissionPercentage commissionRecognitionBasis landlords")
    .lean();

  const rentInvoiced = toAbs(categorySummary.RENT_CHARGE?.totalAmount);
  const rentReceivedManager = toAbs(categorySummary.RENT_RECEIPT_MANAGER?.totalAmount);
  const rentReceivedAll =
    toAbs(categorySummary.RENT_RECEIPT_MANAGER?.totalAmount) +
    toAbs(categorySummary.RENT_RECEIPT_LANDLORD?.totalAmount);

  const recognitionBasis = String(property?.commissionRecognitionBasis || "received").toLowerCase();
  let commissionBase = rentReceivedAll;
  if (recognitionBasis === "invoiced") commissionBase = rentInvoiced;
  if (recognitionBasis === "received_manager_only") commissionBase = rentReceivedManager;

  const commissionPct = Number(property?.commissionPercentage || 0);
  const existingCommission = toAbs(categorySummary.COMMISSION_CHARGE?.totalAmount);
  const computedCommission = commissionPct > 0 ? round2((commissionBase * commissionPct) / 100) : 0;
  const effectiveCommission = existingCommission > 0 ? existingCommission : computedCommission;

  if (existingCommission === 0 && effectiveCommission > 0) {
    categorySummary.COMMISSION_CHARGE = {
      count: 1,
      totalAmount: -effectiveCommission,
      totalDebit: effectiveCommission,
      totalCredit: 0,
    };
  }

  let periodNet;
  if (recognitionBasis === "invoiced") {
    const expenses =
      toAbs(categorySummary.EXPENSE_DEDUCTION?.totalAmount) +
      toAbs(categorySummary.RECURRING_DEDUCTION?.totalAmount) +
      toAbs(categorySummary.ADVANCE_RECOVERY?.totalAmount) +
      toAbs(categorySummary.WRITE_OFF?.totalAmount);
    const additions =
      toAbs(categorySummary.ADJUSTMENT?.totalAmount) +
      toAbs(categorySummary.ADVANCE_TO_LANDLORD?.totalAmount);
    const commission = toAbs(categorySummary.COMMISSION_CHARGE?.totalAmount);
    periodNet = rentInvoiced + additions - expenses - commission;
  } else {
    periodNet = Object.values(categorySummary).reduce(
      (sum, cat) => sum + Number(cat.totalAmount || 0),
      0
    );
  }

  const closingBalance = openingBalance + periodNet;
  const workspace = await buildScheduleWorkspace({ propertyId, landlordId, periodStart, periodEnd, property });

  return {
    propertyId,
    landlordId,
    periodStart,
    periodEnd,
    openingBalance,
    entries,
    totalsByCategory: categorySummary,
    periodNet,
    closingBalance,
    currency: "KES",
    generatedAt: new Date(),
    source: "ledger",
    metadata: {
      workspace,
    },
  };
};

export const generateStatementsForProperty = async ({
  propertyId,
  landlordIds,
  statementPeriodStart,
  statementPeriodEnd,
}) => {
  if (!propertyId || !Array.isArray(landlordIds) || landlordIds.length === 0) {
    throw new Error("generateStatementsForProperty requires propertyId and array of landlordIds");
  }

  return Promise.all(
    landlordIds.map((landlordId) =>
      generateLandlordStatement({
        propertyId,
        landlordId,
        statementPeriodStart,
        statementPeriodEnd,
      })
    )
  );
};
