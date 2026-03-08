import express from "express";
import { verifyToken } from "../../controllers/verifyToken.js";
import { checkInvoiceLedgerEntries, repostInvoicesToLedger, checkUtilityReceiptLedgerEntries } from "../../controllers/propertyController/ledgerDiagnostics.js";

const router = express.Router();

// GET /api/ledger/diagnostics/invoices/:propertyId/:landlordId?period=2026-03
router.get("/diagnostics/invoices/:propertyId/:landlordId", verifyToken, checkInvoiceLedgerEntries);

// POST /api/ledger/diagnostics/repost-invoices
router.post("/diagnostics/repost-invoices", verifyToken, repostInvoicesToLedger);

// GET /api/ledger/diagnostics/utility-receipts
router.get("/diagnostics/utility-receipts", verifyToken, checkUtilityReceiptLedgerEntries);

export default router;
