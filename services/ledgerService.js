import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import mongoose from "mongoose";

/**
 * Double-entry posting service for Milik
 * Creates two FinancialLedgerEntry records for each transaction
 * Ensures SUM(debit) === SUM(credit)
 * Assigns the same journalGroupId to both entries
 */
export async function postDoubleEntry({
  business,
  property,
  landlord,
  tenant,
  unit,
  sourceTransactionType,
  sourceTransactionId,
  transactionDate,
  statementPeriodStart,
  statementPeriodEnd,
  category,
  entries, // [{ accountId, debit, credit }]
  notes,
  status = "approved",
  createdBy,
  approvedBy,
  metadata = {},
}) {
  if (!Array.isArray(entries) || entries.length !== 2) {
    throw new Error("Double-entry posting requires exactly two entries.");
  }
  const totalDebit = entries.reduce((sum, e) => sum + (e.debit || 0), 0);
  const totalCredit = entries.reduce((sum, e) => sum + (e.credit || 0), 0);
  if (totalDebit !== totalCredit) {
    throw new Error("Double-entry transaction is not balanced.");
  }

  const journalGroupId = new mongoose.Types.ObjectId();
  const common = {
    business,
    property,
    landlord,
    tenant,
    unit,
    sourceTransactionType,
    sourceTransactionId,
    transactionDate,
    statementPeriodStart,
    statementPeriodEnd,
    category,
    notes,
    status,
    createdBy,
    approvedBy,
    journalGroupId,
    metadata,
  };

  const [entry1, entry2] = entries;

  const record1 = new FinancialLedgerEntry({
    ...common,
    accountId: entry1.accountId,
    debit: entry1.debit,
    credit: entry1.credit,
  });
  const record2 = new FinancialLedgerEntry({
    ...common,
    accountId: entry2.accountId,
    debit: entry2.debit,
    credit: entry2.credit,
  });

  await record1.save();
  await record2.save();

  return [record1, record2];
}import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";

/**
 * Double-entry posting service for Milik
 * Creates two FinancialLedgerEntry records for each transaction
 * Ensures SUM(debit) === SUM(credit)
 */
export async function postDoubleEntry({
  business,
  property,
  landlord,
  tenant,
  unit,
  sourceTransactionType,
  sourceTransactionId,
  transactionDate,
  statementPeriodStart,
  statementPeriodEnd,
  category,
  entries, // [{ accountId, debit, credit }]
  notes,
  status = "approved",
  createdBy,
  approvedBy,
}) {
  if (!Array.isArray(entries) || entries.length !== 2) {
    throw new Error("Double-entry posting requires exactly two entries.");
  }
  const totalDebit = entries.reduce((sum, e) => sum + (e.debit || 0), 0);
  const totalCredit = entries.reduce((sum, e) => sum + (e.credit || 0), 0);
  if (totalDebit !== totalCredit) {
    throw new Error("Double-entry transaction is not balanced.");
  }

  const common = {
    business,
    property,
    landlord,
    tenant,
    unit,
    sourceTransactionType,
    sourceTransactionId,
    transactionDate,
    statementPeriodStart,
    statementPeriodEnd,
    category,
    notes,
    status,
    createdBy,
    approvedBy,
  };

  const [entry1, entry2] = entries;

  const record1 = new FinancialLedgerEntry({
    ...common,
    accountId: entry1.accountId,
    debit: entry1.debit,
    credit: entry1.credit,
  });
  const record2 = new FinancialLedgerEntry({
    ...common,
    accountId: entry2.accountId,
    debit: entry2.debit,
    credit: entry2.credit,
  });

  await record1.save();
  await record2.save();

  return [record1, record2];
}
