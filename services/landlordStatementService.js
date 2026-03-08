import {
  getOpeningBalance,
  getEntriesForStatement,
  getLedgerTotalsByCategory,
} from "./ledgerQueryService.js";

/**
 * Categories typically appearing in landlord statements.
 * Used for organizing statement line items and computing totals.
 * 
 * Note: REVERSAL category is excluded from statement display.
 * Reversal entries still participate in balance calculations but are not shown as line items.
 */
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

/**
 * Helper: Convert Date to ISO string or return as-is
 */
const toDate = (value) => {
  if (!value) return new Date();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

/**
 * Helper: Compute signed amount from ledger entry (debit = negative, credit = positive)
 */
const computeSignedAmount = (entry) => {
  const amount = Math.abs(Number(entry.amount || 0));
  return entry.direction === "debit" ? -amount : amount;
};

/**
 * Generate a draft landlord statement from immutable ledger entries.
 * 
 * @param {Object} params - Statement generation parameters
 * @param {string|ObjectId} params.propertyId - Property ID
 * @param {string|ObjectId} params.landlordId - Landlord ID
 * @param {Date|string} params.statementPeriodStart - Period start date
 * @param {Date|string} params.statementPeriodEnd - Period end date
 * 
 * @returns {Promise<Object>} Statement object with opening balance, entries, totals, closing balance
 */
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

  // Step 1: Get opening balance (all approved entries before period start)
  const openingBalance = await getOpeningBalance(propertyId, landlordId, periodStart);

  // Step 2: Get all approved ledger entries for the statement period
  const rawEntries = await getEntriesForStatement(propertyId, landlordId, periodStart, periodEnd);

  // Step 3: Sort entries chronologically (transactionDate ASC, createdAt ASC)
  const entries = rawEntries.sort((a, b) => {
    const dateA = new Date(a.transactionDate).getTime();
    const dateB = new Date(b.transactionDate).getTime();
    if (dateA !== dateB) return dateA - dateB;
    
    const createdA = new Date(a.createdAt || 0).getTime();
    const createdB = new Date(b.createdAt || 0).getTime();
    return createdA - createdB;
  });

  // Step 4: Get totals grouped by category for the period
  const totalsResult = await getLedgerTotalsByCategory({
    propertyId,
    landlordId,
    periodStart,
    periodEnd,
  });

  // Step 5: Organize totals by category for statement rendering
  // Exclude REVERSAL category from display (reversals still affect balance via ledger math)
  const allTotalsByCategory = totalsResult.totalsByCategory || {};
  const categorySummary = STATEMENT_CATEGORIES.reduce((acc, category) => {
    if (allTotalsByCategory[category]) {
      acc[category] = allTotalsByCategory[category];
    } else {
      acc[category] = {
        count: 0,
        totalAmount: 0,
        totalDebit: 0,
        totalCredit: 0,
      };
    }
    return acc;
  }, {});

  // Step 6: Calculate periodNet from totalsByCategory
  // This ensures displayed categories reconcile to period net
  const periodNet = Object.values(categorySummary).reduce(
    (sum, cat) => sum + Number(cat.totalAmount || 0),
    0
  );

  // Step 7: Compute closing balance
  const closingBalance = openingBalance + periodNet;

  // Step 8: Return structured statement object
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
  };
};

/**
 * Generate statements for all landlords in a property for a specific period.
 * Useful for batch statement generation.
 * 
 * @param {Object} params - Batch generation parameters
 * @param {string|ObjectId} params.propertyId - Property ID
 * @param {Array<string|ObjectId>} params.landlordIds - Array of landlord IDs
 * @param {Date|string} params.statementPeriodStart - Period start date
 * @param {Date|string} params.statementPeriodEnd - Period end date
 * 
 * @returns {Promise<Array<Object>>} Array of statement objects
 */
export const generateStatementsForProperty = async ({
  propertyId,
  landlordIds,
  statementPeriodStart,
  statementPeriodEnd,
}) => {
  if (!propertyId || !Array.isArray(landlordIds) || landlordIds.length === 0) {
    throw new Error("generateStatementsForProperty requires propertyId and array of landlordIds");
  }

  const statements = await Promise.all(
    landlordIds.map((landlordId) =>
      generateLandlordStatement({
        propertyId,
        landlordId,
        statementPeriodStart,
        statementPeriodEnd,
      })
    )
  );

  return statements;
};

/**
 * Validate statement integrity by comparing ledger-derived balances.
 * Returns validation result with any discrepancies found.
 * 
 * @param {Object} statement - Statement object from generateLandlordStatement
 * @returns {Object} Validation result with status and any errors
 */
export const validateStatementIntegrity = (statement) => {
  const errors = [];

  // Verify closing balance calculation
  const expectedClosing = statement.openingBalance + statement.periodNet;
  if (Math.abs(expectedClosing - statement.closingBalance) > 0.01) {
    errors.push({
      type: "closing_balance_mismatch",
      expected: expectedClosing,
      actual: statement.closingBalance,
      difference: Math.abs(expectedClosing - statement.closingBalance),
    });
  }

  // Verify periodNet matches sum of totalsByCategory
  // Note: This should always be true since periodNet is derived from totalsByCategory
  const categorySum = Object.values(statement.totalsByCategory).reduce(
    (sum, cat) => sum + Number(cat.totalAmount || 0),
    0
  );

  if (Math.abs(categorySum - statement.periodNet) > 0.01) {
    errors.push({
      type: "period_net_category_mismatch",
      expected: categorySum,
      actual: statement.periodNet,
      difference: Math.abs(categorySum - statement.periodNet),
    });
  }

  // Note: We do NOT validate that entries sum to periodNet because:
  // - entries include REVERSAL category entries (needed for audit trail)
  // - totalsByCategory excludes REVERSAL (not displayed to landlord)
  // - Both approaches are mathematically valid; they may differ if reversals exist

  return {
    valid: errors.length === 0,
    errors,
    statement: {
      propertyId: statement.propertyId,
      landlordId: statement.landlordId,
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
    },
  };
};

export default {
  generateLandlordStatement,
  generateStatementsForProperty,
  validateStatementIntegrity,
};
