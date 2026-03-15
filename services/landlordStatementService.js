import mongoose from "mongoose";
import Property from "../models/Property.js";
import Unit from "../models/Unit.js";
import Tenant from "../models/Tenant.js";
import TenantInvoice from "../models/TenantInvoice.js";
import RentPayment from "../models/RentPayment.js";
import ExpenseProperty from "../models/ExpenseProperty.js";

const round2 = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const toDate = (value, fallback = new Date()) => {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback) : date;
};
const startOfDay = (value) => {
  const d = toDate(value);
  d.setHours(0, 0, 0, 0);
  return d;
};
const endOfDay = (value) => {
  const d = toDate(value);
  d.setHours(23, 59, 59, 999);
  return d;
};
const oid = (value) => (typeof value === "string" && mongoose.Types.ObjectId.isValid(value)
  ? new mongoose.Types.ObjectId(value)
  : value);
const safeName = (value = "") => String(value || "").trim().toLowerCase();

const detectUtilityBucket = (text = "") => {
  const name = safeName(text);
  if (/water/.test(name)) return "water";
  if (/garbage|refuse|trash|waste/.test(name)) return "garbage";
  return "";
};

const listUtilityNames = (row) => [
  ...(Array.isArray(row?.unitUtilities) ? row.unitUtilities : []),
  ...(Array.isArray(row?.tenantUtilities) ? row.tenantUtilities : []),
]
  .map((u) => safeName(u?.utility || u?.utilityLabel || u?.name || u))
  .filter(Boolean);

const hasUtilityType = (row, type) => {
  const list = listUtilityNames(row);
  if (type === "water") return list.some((name) => /water/.test(name));
  if (type === "garbage") return list.some((name) => /garbage|refuse|trash|waste/.test(name));
  return false;
};

const getReceiptCategory = (paymentType, paidDirectToLandlord) => {
  if (paymentType === "utility") return paidDirectToLandlord ? "UTILITY_RECEIPT_LANDLORD" : "UTILITY_RECEIPT_MANAGER";
  return paidDirectToLandlord ? "RENT_RECEIPT_LANDLORD" : "RENT_RECEIPT_MANAGER";
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

  const propertyObjectId = oid(propertyId);
  const periodStart = startOfDay(statementPeriodStart);
  const periodEnd = endOfDay(statementPeriodEnd);

  const property = await Property.findById(propertyObjectId)
    .select("propertyCode propertyName name address city commissionPercentage commissionRecognitionBasis totalUnits business landlords")
    .lean();

  if (!property) throw new Error("Property not found");

  const units = await Unit.find({ property: propertyObjectId })
    .select("_id unitNumber name rent utilities status isVacant property")
    .lean();
  const unitIds = units.map((u) => u._id);

  const tenants = await Tenant.find({ unit: { $in: unitIds }, status: { $nin: ["inactive", "moved_out", "evicted"] } })
    .select("_id name tenantCode rent status unit utilities paymentMethod balance moveInDate createdAt")
    .lean();

  const [
    invoicesBefore,
    invoicesInPeriod,
    receiptsBefore,
    receiptsInPeriod,
    expensesInPeriod,
  ] = await Promise.all([
    TenantInvoice.find({
      property: propertyObjectId,
      business: property.business,
      invoiceDate: { $lt: periodStart },
      status: { $nin: ["cancelled", "reversed"] },
    }).select("_id tenant unit category amount description invoiceDate invoiceNumber landlord").lean(),
    TenantInvoice.find({
      property: propertyObjectId,
      business: property.business,
      invoiceDate: { $gte: periodStart, $lte: periodEnd },
      status: { $nin: ["cancelled", "reversed"] },
    }).select("_id tenant unit category amount description invoiceDate invoiceNumber landlord").lean(),
    RentPayment.find({
      business: property.business,
      unit: { $in: unitIds },
      paymentDate: { $lt: periodStart },
      isConfirmed: true,
      isCancelled: { $ne: true },
      isReversed: { $ne: true },
      paymentType: { $in: ["rent", "utility"] },
    }).select("_id tenant unit amount paymentType paymentDate paidDirectToLandlord description referenceNumber receiptNumber breakdown utilities").lean(),
    RentPayment.find({
      business: property.business,
      unit: { $in: unitIds },
      paymentDate: { $gte: periodStart, $lte: periodEnd },
      isConfirmed: true,
      isCancelled: { $ne: true },
      isReversed: { $ne: true },
      paymentType: { $in: ["rent", "utility"] },
    }).select("_id tenant unit amount paymentType paymentDate paidDirectToLandlord description referenceNumber receiptNumber breakdown utilities").lean(),
    ExpenseProperty.find({
      property: propertyObjectId,
      business: property.business,
      date: { $gte: periodStart, $lte: periodEnd },
    }).select("_id amount description date category unit").lean(),
  ]);

  const unitMap = new Map(units.map((u) => [String(u._id), u]));
  const tenantsByUnit = new Map();
  tenants.forEach((tenant) => {
    const key = String(tenant.unit);
    if (!tenantsByUnit.has(key)) tenantsByUnit.set(key, []);
    tenantsByUnit.get(key).push(tenant);
  });

  const rowsMap = new Map();

  const ensureRow = (tenantId, unitId, fallback = {}) => {
    const resolvedUnitId = String(unitId || fallback.unitId || fallback.unit || "");
    const unit = unitMap.get(resolvedUnitId) || {};
    const tenant = tenantId ? tenants.find((t) => String(t._id) === String(tenantId)) || {} : {};
    const key = `${resolvedUnitId}:${String(tenant._id || tenantId || "vacant")}`;

    if (!rowsMap.has(key)) {
      rowsMap.set(key, {
        key,
        tenantId: String(tenant._id || tenantId || ""),
        unitId: resolvedUnitId,
        unit: unit.unitNumber || unit.name || fallback.unitLabel || "-",
        accountNo: tenant.tenantCode || fallback.accountNo || "-",
        tenantName: tenant.name || fallback.tenantName || "VACANT",
        perMonth: Number(tenant.rent || unit.rent || fallback.perMonth || 0),
        balanceBF: 0,
        invoicedRent: 0,
        invoicedGarbage: 0,
        invoicedWater: 0,
        paidRent: 0,
        paidGarbage: 0,
        paidWater: 0,
        balanceCF: 0,
        unitUtilities: Array.isArray(unit.utilities) ? unit.utilities : [],
        tenantUtilities: Array.isArray(tenant.utilities) ? tenant.utilities : [],
        referenceNumbers: [],
      });
    }

    return rowsMap.get(key);
  };

  units.forEach((unit) => {
    const unitTenants = (tenantsByUnit.get(String(unit._id)) || []).sort((a, b) => {
      const da = new Date(a.moveInDate || a.createdAt || 0).getTime();
      const db = new Date(b.moveInDate || b.createdAt || 0).getTime();
      return db - da;
    });
    if (unitTenants.length > 0) {
      unitTenants.forEach((tenant) => ensureRow(tenant._id, unit._id));
    } else {
      ensureRow(null, unit._id, { tenantName: "VACANT" });
    }
  });

  const entries = [];
  const pushEntry = ({
    tenantId,
    unitId,
    transactionDate,
    category,
    amount,
    direction,
    description,
    sourceTransactionType,
    sourceTransactionId,
    metadata = {},
  }) => {
    entries.push({
      _id: new mongoose.Types.ObjectId(),
      tenant: tenantId || null,
      unit: unitId || null,
      transactionDate,
      createdAt: transactionDate,
      category,
      amount: round2(Math.abs(amount || 0)),
      direction,
      notes: description,
      description,
      sourceTransactionType: sourceTransactionType || null,
      sourceTransactionId: sourceTransactionId || null,
      metadata,
    });
  };

  const applyUtility = (row, phase, amount, hint) => {
    const value = round2(amount);
    if (value <= 0) return;

    const bucket = detectUtilityBucket(hint);
    const waterAllowed = hasUtilityType(row, "water");
    const garbageAllowed = hasUtilityType(row, "garbage");

    if (bucket === "water" && waterAllowed) {
      row[phase === "invoice" ? "invoicedWater" : "paidWater"] += value;
      return;
    }
    if (bucket === "garbage" && garbageAllowed) {
      row[phase === "invoice" ? "invoicedGarbage" : "paidGarbage"] += value;
      return;
    }
    if (waterAllowed && !garbageAllowed) {
      row[phase === "invoice" ? "invoicedWater" : "paidWater"] += value;
      return;
    }
    if (garbageAllowed && !waterAllowed) {
      row[phase === "invoice" ? "invoicedGarbage" : "paidGarbage"] += value;
    }
  };

  for (const invoice of invoicesBefore) {
    const row = ensureRow(invoice.tenant, invoice.unit);
    const amount = Number(invoice.amount || 0);
    if (invoice.category === "RENT_CHARGE") {
      row.balanceBF += amount;
    } else if (invoice.category === "UTILITY_CHARGE") {
      applyUtility(row, "invoice", amount, invoice.description || invoice.invoiceNumber || "");
      row.balanceBF += amount;
    }
  }

  for (const receipt of receiptsBefore) {
    const row = ensureRow(receipt.tenant, receipt.unit);
    row.balanceBF -= Number(receipt.amount || 0);
  }

  for (const invoice of invoicesInPeriod) {
    const row = ensureRow(invoice.tenant, invoice.unit);
    const amount = Number(invoice.amount || 0);

    if (invoice.category === "RENT_CHARGE") {
      row.invoicedRent += amount;
    } else if (invoice.category === "UTILITY_CHARGE") {
      applyUtility(row, "invoice", amount, invoice.description || invoice.invoiceNumber || "");
    }
    if (invoice.invoiceNumber) row.referenceNumbers.push(invoice.invoiceNumber);

    pushEntry({
      tenantId: invoice.tenant,
      unitId: invoice.unit,
      transactionDate: invoice.invoiceDate,
      category: invoice.category,
      amount,
      direction: "credit",
      description: invoice.description || invoice.invoiceNumber || "Tenant invoice",
      sourceTransactionType: "invoice",
      sourceTransactionId: String(invoice._id),
      metadata: {
        tenantName: row.tenantName,
        unit: row.unit,
        tenantCode: row.accountNo,
      },
    });
  }

  let totalRentReceivedManager = 0;
  let totalRentReceivedLandlord = 0;
  let totalUtilityReceivedManager = 0;
  let totalUtilityReceivedLandlord = 0;
  let directToLandlordDeduction = 0;

  for (const receipt of receiptsInPeriod) {
    const row = ensureRow(receipt.tenant, receipt.unit);
    const amount = Number(receipt.amount || 0);
    const description = receipt.description || receipt.referenceNumber || receipt.receiptNumber || "Tenant receipt";

    if (receipt.paymentType === "rent") {
      row.paidRent += amount;
      if (receipt.paidDirectToLandlord) totalRentReceivedLandlord += amount;
      else totalRentReceivedManager += amount;
    } else if (receipt.paymentType === "utility") {
      const utilityBreakdown = Array.isArray(receipt.breakdown?.utilities) ? receipt.breakdown.utilities : [];
      if (utilityBreakdown.length > 0) {
        utilityBreakdown.forEach((util) => {
          applyUtility(row, "receipt", Number(util.amount || 0), util.name || util.utility || receipt.description || "");
        });
      } else {
        applyUtility(row, "receipt", amount, receipt.description || "");
      }
      if (receipt.paidDirectToLandlord) totalUtilityReceivedLandlord += amount;
      else totalUtilityReceivedManager += amount;
    }
    if (receipt.referenceNumber) row.referenceNumbers.push(receipt.referenceNumber);
    if (receipt.receiptNumber) row.referenceNumbers.push(receipt.receiptNumber);

    pushEntry({
      tenantId: receipt.tenant,
      unitId: receipt.unit,
      transactionDate: receipt.paymentDate,
      category: getReceiptCategory(receipt.paymentType, receipt.paidDirectToLandlord),
      amount,
      direction: "credit",
      description,
      sourceTransactionType: "receipt",
      sourceTransactionId: String(receipt._id),
      metadata: {
        tenantName: row.tenantName,
        unit: row.unit,
        tenantCode: row.accountNo,
        paidDirectToLandlord: !!receipt.paidDirectToLandlord,
      },
    });

    if (receipt.paidDirectToLandlord) {
      directToLandlordDeduction += amount;
      pushEntry({
        tenantId: receipt.tenant,
        unitId: receipt.unit,
        transactionDate: receipt.paymentDate,
        category: "EXPENSE_DEDUCTION",
        amount,
        direction: "debit",
        description: `Paid directly to landlord - ${row.tenantName}`,
        sourceTransactionType: "receipt",
        sourceTransactionId: String(receipt._id),
        metadata: {
          deductionType: "direct_to_landlord",
          tenantName: row.tenantName,
          unit: row.unit,
          tenantCode: row.accountNo,
        },
      });
    }
  }

  let totalExpenses = 0;
  for (const expense of expensesInPeriod) {
    const amount = Number(expense.amount || 0);
    totalExpenses += amount;
    pushEntry({
      tenantId: null,
      unitId: expense.unit || null,
      transactionDate: expense.date,
      category: "EXPENSE_DEDUCTION",
      amount,
      direction: "debit",
      description: expense.description || `Property expense - ${expense.category}`,
      sourceTransactionType: "expense",
      sourceTransactionId: String(expense._id),
      metadata: {
        expenseCategory: expense.category,
      },
    });
  }

  const tenantRows = Array.from(rowsMap.values())
    .map((row) => {
      row.balanceBF = round2(row.balanceBF);
      row.invoicedRent = round2(row.invoicedRent);
      row.invoicedGarbage = round2(row.invoicedGarbage);
      row.invoicedWater = round2(row.invoicedWater);
      row.paidRent = round2(row.paidRent);
      row.paidGarbage = round2(row.paidGarbage);
      row.paidWater = round2(row.paidWater);
      row.balanceCF = round2(
        row.balanceBF + row.invoicedRent + row.invoicedGarbage + row.invoicedWater - row.paidRent - row.paidGarbage - row.paidWater
      );
      row.referenceNumbers = Array.from(new Set((row.referenceNumbers || []).filter(Boolean)));
      return row;
    })
    .sort((a, b) => String(a.unit).localeCompare(String(b.unit), undefined, { numeric: true }));

  const totalRentInvoiced = round2(tenantRows.reduce((sum, row) => sum + row.invoicedRent, 0));
  const totalGarbageInvoiced = round2(tenantRows.reduce((sum, row) => sum + row.invoicedGarbage, 0));
  const totalWaterInvoiced = round2(tenantRows.reduce((sum, row) => sum + row.invoicedWater, 0));
  const totalRentReceived = round2(tenantRows.reduce((sum, row) => sum + row.paidRent, 0));
  const totalGarbageReceived = round2(tenantRows.reduce((sum, row) => sum + row.paidGarbage, 0));
  const totalWaterReceived = round2(tenantRows.reduce((sum, row) => sum + row.paidWater, 0));
  const totalBalanceBF = round2(tenantRows.reduce((sum, row) => sum + row.balanceBF, 0));
  const totalBalanceCF = round2(tenantRows.reduce((sum, row) => sum + row.balanceCF, 0));

  const commissionPct = Number(property.commissionPercentage || 0);
  const recognitionBasis = String(property.commissionRecognitionBasis || "received").toLowerCase();
  let commissionBase = totalRentReceived + totalRentReceivedLandlord;
  if (recognitionBasis === "invoiced") commissionBase = totalRentInvoiced;
  if (recognitionBasis === "received_manager_only") commissionBase = totalRentReceivedManager;
  const commissionAmount = round2((commissionBase * commissionPct) / 100);
  if (commissionAmount > 0) {
    pushEntry({
      transactionDate: periodEnd,
      category: "COMMISSION_CHARGE",
      amount: commissionAmount,
      direction: "debit",
      description: `Management commission (${commissionPct}%)`,
      sourceTransactionType: "statement_commission",
      sourceTransactionId: `${propertyObjectId}-${periodStart.toISOString()}`,
      metadata: { commissionPercentage: commissionPct, commissionBasis: recognitionBasis },
    });
  }

  const managerCollections = round2(totalRentReceivedManager + totalUtilityReceivedManager);
  const deductions = round2(totalExpenses + directToLandlordDeduction + commissionAmount);
  const netRemittance = round2(managerCollections - deductions);
  const occupiedUnits = tenantRows.filter((row) => row.tenantName !== "VACANT").length;
  const vacantUnits = tenantRows.filter((row) => row.tenantName === "VACANT").length;

  const expenseRows = [
    ...expensesInPeriod.map((expense) => ({
      date: expense.date,
      description: expense.description || `Property expense - ${expense.category}`,
      amount: round2(expense.amount),
      category: expense.category || "expense",
      sourceId: String(expense._id),
    })),
    ...receiptsInPeriod
      .filter((r) => r.paidDirectToLandlord)
      .map((r) => {
        const row = ensureRow(r.tenant, r.unit);
        return {
          date: r.paymentDate,
          description: `Paid directly to landlord - ${row.tenantName}`,
          amount: round2(r.amount),
          category: "direct_to_landlord",
          sourceId: String(r._id),
        };
      }),
    ...(commissionAmount > 0
      ? [{
          date: periodEnd,
          description: `Management commission (${commissionPct}%)`,
          amount: commissionAmount,
          category: "commission",
          sourceId: `commission-${propertyObjectId}-${periodStart.toISOString()}`,
        }]
      : []),
  ];

  const workspace = {
    periodLabel: `${periodStart.toLocaleString("en-KE", { month: "long" })} ${periodStart.getFullYear()}`,
    propertyLabel: `${property.propertyCode ? `[${property.propertyCode}] ` : ""}${property.propertyName || property.name || "Property"}`,
    landlordLabel: (() => {
      const ll = (property.landlords || []).find((l) => String(l.landlordId) === String(landlordId)) || {};
      return ll.name || "Landlord";
    })(),
    rows: tenantRows.map((row) => ({
      ...row,
      openingBalance: row.balanceBF,
      closingBalance: row.balanceCF,
    })),
    totals: {
      perMonth: round2(tenantRows.reduce((sum, row) => sum + row.perMonth, 0)),
      openingBalance: totalBalanceBF,
      invoicedRent: totalRentInvoiced,
      invoicedGarbage: totalGarbageInvoiced,
      invoicedWater: totalWaterInvoiced,
      paidRent: totalRentReceived,
      paidGarbage: totalGarbageReceived,
      paidWater: totalWaterReceived,
      closingBalance: totalBalanceCF,
    },
    expenseRows,
    summary: {
      rentInvoiced: totalRentInvoiced,
      utilityInvoiced: round2(totalGarbageInvoiced + totalWaterInvoiced),
      managerCollections,
      directToLandlordCollections: round2(totalRentReceivedLandlord + totalUtilityReceivedLandlord),
      deductions,
      netStatement: netRemittance,
      amountPayableToLandlord: netRemittance > 0 ? netRemittance : 0,
      isNegativeStatement: netRemittance < 0,
      amountPayableByLandlordToManager: netRemittance < 0 ? Math.abs(netRemittance) : 0,
      propertyExpenses: round2(totalExpenses),
      commissionPercentage: commissionPct,
      commissionBasis: recognitionBasis,
      commissionAmount,
      occupiedUnits,
      vacantUnits,
    },
  };

  const totalsByCategory = {
    RENT_CHARGE: { count: invoicesInPeriod.filter((i) => i.category === "RENT_CHARGE").length, totalAmount: totalRentInvoiced, totalDebit: 0, totalCredit: totalRentInvoiced },
    UTILITY_CHARGE: { count: invoicesInPeriod.filter((i) => i.category === "UTILITY_CHARGE").length, totalAmount: round2(totalGarbageInvoiced + totalWaterInvoiced), totalDebit: 0, totalCredit: round2(totalGarbageInvoiced + totalWaterInvoiced) },
    RENT_RECEIPT_MANAGER: { count: receiptsInPeriod.filter((r) => r.paymentType === "rent" && !r.paidDirectToLandlord).length, totalAmount: round2(totalRentReceivedManager), totalDebit: 0, totalCredit: round2(totalRentReceivedManager) },
    RENT_RECEIPT_LANDLORD: { count: receiptsInPeriod.filter((r) => r.paymentType === "rent" && r.paidDirectToLandlord).length, totalAmount: round2(totalRentReceivedLandlord), totalDebit: 0, totalCredit: round2(totalRentReceivedLandlord) },
    UTILITY_RECEIPT_MANAGER: { count: receiptsInPeriod.filter((r) => r.paymentType === "utility" && !r.paidDirectToLandlord).length, totalAmount: round2(totalUtilityReceivedManager), totalDebit: 0, totalCredit: round2(totalUtilityReceivedManager) },
    UTILITY_RECEIPT_LANDLORD: { count: receiptsInPeriod.filter((r) => r.paymentType === "utility" && r.paidDirectToLandlord).length, totalAmount: round2(totalUtilityReceivedLandlord), totalDebit: 0, totalCredit: round2(totalUtilityReceivedLandlord) },
    EXPENSE_DEDUCTION: { count: expenseRows.length, totalAmount: round2(-deductions), totalDebit: deductions, totalCredit: 0 },
    COMMISSION_CHARGE: { count: commissionAmount > 0 ? 1 : 0, totalAmount: round2(-commissionAmount), totalDebit: commissionAmount, totalCredit: 0 },
  };

  return {
    propertyId,
    landlordId,
    periodStart,
    periodEnd,
    openingBalance: totalBalanceBF,
    entries: entries.sort((a, b) => new Date(a.transactionDate) - new Date(b.transactionDate)),
    totalsByCategory,
    periodNet: netRemittance,
    closingBalance: totalBalanceCF,
    currency: "KES",
    generatedAt: new Date(),
    source: "operational_statement",
    metadata: workspace,
  };
};

export default { generateLandlordStatement };
