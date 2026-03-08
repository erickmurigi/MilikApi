import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";

const flipDirection = (direction) => (direction === "credit" ? "debit" : "credit");

const normalizeDate = (value, fallback = new Date()) => {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback) : date;
};

const validatePayload = (payload) => {
  const requiredFields = [
    "business",
    "property",
    "landlord",
    "sourceTransactionType",
    "sourceTransactionId",
    "transactionDate",
    "statementPeriodStart",
    "statementPeriodEnd",
    "category",
    "amount",
    "direction",
    "createdBy",
  ];

  const missing = requiredFields.filter((field) => payload[field] === undefined || payload[field] === null || payload[field] === "");
  if (missing.length > 0) {
    throw new Error(`Missing ledger payload fields: ${missing.join(", ")}`);
  }
};

export const postEntry = async (payload) => {
  validatePayload(payload);

  const entry = new FinancialLedgerEntry({
    ...payload,
    transactionDate: normalizeDate(payload.transactionDate),
    statementPeriodStart: normalizeDate(payload.statementPeriodStart),
    statementPeriodEnd: normalizeDate(payload.statementPeriodEnd),
    amount: Math.abs(Number(payload.amount || 0)),
    approvedBy: payload.approvedBy || payload.createdBy || null,
    approvedAt: payload.approvedAt || new Date(),
    status: payload.status || "approved",
  });

  return entry.save();
};

export const postReversal = async ({ entryId, reason, userId }) => {
  if (!entryId || !userId) {
    throw new Error("postReversal requires entryId and userId");
  }

  const originalEntry = await FinancialLedgerEntry.findById(entryId);
  if (!originalEntry) {
    throw new Error("Ledger entry not found");
  }

  if (originalEntry.reversedByEntry || originalEntry.status === "reversed") {
    throw new Error("Ledger entry already reversed");
  }

  const reversalEntry = await postEntry({
    business: originalEntry.business,
    property: originalEntry.property,
    landlord: originalEntry.landlord,
    tenant: originalEntry.tenant,
    unit: originalEntry.unit,
    sourceTransactionType: originalEntry.sourceTransactionType,
    sourceTransactionId: originalEntry.sourceTransactionId,
    transactionDate: new Date(),
    statementPeriodStart: originalEntry.statementPeriodStart,
    statementPeriodEnd: originalEntry.statementPeriodEnd,
    category: "REVERSAL",
    amount: originalEntry.amount,
    direction: flipDirection(originalEntry.direction),
    payer: originalEntry.receiver || "n/a",
    receiver: originalEntry.payer || "n/a",
    notes: reason || `Reversal of ledger entry ${originalEntry._id}`,
    reversalOf: originalEntry._id,
    metadata: {
      reversalReason: reason || "Correction",
      reversedEntryCategory: originalEntry.category,
      reversedEntryId: String(originalEntry._id),
      originalMetadata: originalEntry.metadata || {},
    },
    createdBy: userId,
    approvedBy: userId,
    approvedAt: new Date(),
    status: "approved",
  });

  // Mark original entry as reversed while preserving immutable amount/source values.
  originalEntry.status = "reversed";
  originalEntry.reversedByEntry = reversalEntry._id;
  await originalEntry.save();

  return {
    originalEntry,
    reversalEntry,
  };
};

export const postCorrection = async ({ entryId, correctedPayload, reason, userId }) => {
  if (!entryId || !correctedPayload || !userId) {
    throw new Error("postCorrection requires entryId, correctedPayload, and userId");
  }

  const { originalEntry, reversalEntry } = await postReversal({
    entryId,
    reason: reason || "Correction reversal",
    userId,
  });

  const correctedEntryPayload = {
    ...correctedPayload,
    business: correctedPayload.business || originalEntry.business,
    property: correctedPayload.property || originalEntry.property,
    landlord: correctedPayload.landlord || originalEntry.landlord,
    tenant: correctedPayload.tenant ?? originalEntry.tenant,
    unit: correctedPayload.unit ?? originalEntry.unit,
    sourceTransactionType: correctedPayload.sourceTransactionType || originalEntry.sourceTransactionType,
    sourceTransactionId: correctedPayload.sourceTransactionId || originalEntry.sourceTransactionId,
    transactionDate: correctedPayload.transactionDate || new Date(),
    statementPeriodStart: correctedPayload.statementPeriodStart || originalEntry.statementPeriodStart,
    statementPeriodEnd: correctedPayload.statementPeriodEnd || originalEntry.statementPeriodEnd,
    payer: correctedPayload.payer || originalEntry.payer,
    receiver: correctedPayload.receiver || originalEntry.receiver,
    notes: correctedPayload.notes || `Correction repost after reversal of ${originalEntry._id}`,
    metadata: {
      ...(originalEntry.metadata || {}),
      ...(correctedPayload.metadata || {}),
      correctionOf: String(originalEntry._id),
      reversalEntryId: String(reversalEntry._id),
      correctionReason: reason || "Correction repost",
    },
    createdBy: userId,
    approvedBy: userId,
    approvedAt: new Date(),
    status: correctedPayload.status || "approved",
  };

  const correctedEntry = await postEntry(correctedEntryPayload);

  return {
    originalEntry,
    reversalEntry,
    correctedEntry,
  };
};

export default {
  postEntry,
  postReversal,
  postCorrection,
};
