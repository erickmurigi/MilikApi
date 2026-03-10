import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import RentPayment from "../../models/RentPayment.js";
import Unit from "../../models/Unit.js";
import Property from "../../models/Property.js";
import { postEntry } from "../../services/ledgerPostingService.js";

/**
 * Diagnostic endpoint: Check if invoices have corresponding ledger entries
 * GET /api/ledger/diagnostics/invoices/:propertyId/:landlordId?period=YYYY-MM
 */
export const checkInvoiceLedgerEntries = async (req, res) => {
  try {
    const { propertyId, landlordId } = req.params;
    const { period } = req.query; // Format: "2026-03" for March 2026

    const businessId = req.user?.company;
    if (!businessId) {
      return res.status(400).json({ error: "Business context required" });
    }

    // Parse period if provided
    let periodStart, periodEnd;
    if (period) {
      const [year, month] = period.split('-').map(Number);
      periodStart = new Date(year, month - 1, 1);
      periodEnd = new Date(year, month, 0);
    }

    // Find all tenant invoices for this property/landlord
    const invoiceQuery = {
      business: businessId,
    };

    if (periodStart && periodEnd) {
      invoiceQuery.invoiceDate = { $gte: periodStart, $lte: periodEnd };
    }

    const invoices = await TenantInvoice.find(invoiceQuery)
      .populate('tenant', 'name')
      .populate('unit', 'unitNumber property')
      .lean();

    // Filter by property if specified
    const relevantInvoices = propertyId
      ? invoices.filter(inv => String(inv.unit?.property) === String(propertyId))
      : invoices;

    // Check each invoice for ledger entry
    const diagnostics = [];
        for (const invoice of relevantInvoices) {
          const ledgerEntry = await FinancialLedgerEntry.findOne({
            sourceTransactionType: "invoice",
            sourceTransactionId: invoice._id,
            status: "approved",
          });

          diagnostics.push({
            invoiceId: invoice._id,
            invoiceNumber: invoice.invoiceNumber,
            tenant: invoice.tenant?.name || "Unknown",
            unit: invoice.unit?.unitNumber || "Unknown",
            amount: invoice.amount,
            category: invoice.category,
            invoiceDate: invoice.invoiceDate,
            dueDate: invoice.dueDate,
            status: invoice.status,
            hasLedgerEntry: !!ledgerEntry,
            ledgerCategory: ledgerEntry?.category || null,
            ledgerPeriodStart: ledgerEntry?.statementPeriodStart || null,
            ledgerPeriodEnd: ledgerEntry?.statementPeriodEnd || null,
            ledgerAmount: ledgerEntry?.amount || null,
            ledgerDirection: ledgerEntry?.direction || null,
          });
        }

        const summary = {
          totalInvoices: diagnostics.length,
          invoicesWithLedger: diagnostics.filter(d => d.hasLedgerEntry).length,
          invoicesWithoutLedger: diagnostics.filter(d => !d.hasLedgerEntry).length,
        };

        res.status(200).json({ diagnostics, summary });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- New export below ---
export const repostInvoicesToLedger = async (req, res) => {
  try {
    const { propertyId, period } = req.body;
    const businessId = req.user?.company;
    const userId = req.user?._id || req.user?.id;

    if (!businessId || !userId) {
      return res.status(400).json({ error: "Authentication required" });
    }

    // Parse period
    let periodStart, periodEnd;
    if (period) {
      const [year, month] = period.split('-').map(Number);
      periodStart = new Date(year, month - 1, 1);
      periodEnd = new Date(year, month, 0);
    }

    // Find invoices without ledger entries
    const invoiceQuery = {
      business: businessId,
      ledgerType: "invoices",
    };

    if (periodStart && periodEnd) {
      invoiceQuery.paymentDate = { $gte: periodStart, $lte: periodEnd };
    }

    const invoices = await RentPayment.find(invoiceQuery)
      .populate('unit', 'property')
      .lean();

    const filtered = propertyId
      ? invoices.filter(inv => String(inv.unit?.property) === String(propertyId))
      : invoices;

    let posted = 0;
    let skipped = 0;
    const errors = [];

    for (const invoice of filtered) {
      // Check if ledger entry already exists
      const exists = await FinancialLedgerEntry.findOne({
        sourceTransactionType: "rent_payment",
        sourceTransactionId: invoice._id,
      });

      if (exists) {
        skipped++;
        continue;
      }

      // Get property and landlord info
      const unit = await Unit.findById(invoice.unit).select('property').lean();
      if (!unit?.property) {
        errors.push({
          invoiceId: invoice._id,
          referenceNumber: invoice.referenceNumber,
          error: "Unit property not found",
        });
        continue;
      }

      const property = await Property.findById(unit.property).select('landlords').lean();
      if (!property) {
        errors.push({
          invoiceId: invoice._id,
          referenceNumber: invoice.referenceNumber,
          error: "Property not found",
        });
        continue;
      }

      const landlords = Array.isArray(property.landlords) ? property.landlords : [];
      const primary = landlords.find(item => item?.isPrimary && item?.landlordId);
      const fallback = landlords.find(item => item?.landlordId);
      const landlordId = primary?.landlordId || fallback?.landlordId || null;

      if (!landlordId) {
        errors.push({
          invoiceId: invoice._id,
          referenceNumber: invoice.referenceNumber,
          error: "Landlord not found",
        });
        continue;
      }

      // Determine category
      const category = invoice.paymentType === "utility" ? "UTILITY_CHARGE" : "RENT_CHARGE";

      // Calculate statement period
      const paymentDate = invoice.paymentDate ? new Date(invoice.paymentDate) : new Date();
      const fallbackMonth = paymentDate.getMonth() + 1;
      const fallbackYear = paymentDate.getFullYear();
      const month = Number(invoice.month || fallbackMonth);
      const year = Number(invoice.year || fallbackYear);
      const start = new Date(year, Math.max(month - 1, 0), 1, 0, 0, 0, 0);
      const end = new Date(year, Math.max(month, 1), 0, 23, 59, 59, 999);

      // Try to post
      try {
        await postEntry({
          business: invoice.business,
          property: unit.property,
          landlord: landlordId,
          tenant: invoice.tenant || null,
          unit: invoice.unit || null,
          sourceTransactionType: "rent_payment",
          sourceTransactionId: String(invoice._id),
          transactionDate: paymentDate,
          statementPeriodStart: start,
          statementPeriodEnd: end,
          category,
          amount: Math.abs(Number(invoice.amount || 0)),
          direction: "debit",
          payer: "tenant",
          receiver: "manager",
          notes: `Auto-posted from invoice ${invoice.receiptNumber || invoice.referenceNumber || invoice._id}`,
          metadata: {
            paymentType: invoice.paymentType,
            paymentMethod: invoice.paymentMethod,
            cashbook: invoice.cashbook || "Tenant Receivables Control",
            paidDirectToLandlord: false,
            ledgerType: "invoices",
            receiptNumber: invoice.receiptNumber || null,
            referenceNumber: invoice.referenceNumber || null,
          },
          createdBy: userId,
          approvedBy: userId,
          approvedAt: new Date(),
          status: "approved",
        });
        posted++;
      } catch (err) {
        errors.push({
          invoiceId: invoice._id,
          referenceNumber: invoice.referenceNumber,
          error: err.message,
        });
      }
    }

    res.json({
      success: true,
      posted,
      skipped,
      errors,
      message: `Posted ${posted} invoices to ledger, skipped ${skipped} existing entries`,
    });
  } catch (error) {
    console.error("Repost invoices error:", error);
    res.status(500).json({ error: error.message || "Repost failed" });
  }
};

// GET /api/ledger/diagnostics/utility-receipts?propertyId=...&landlordId=...&periodStart=...&periodEnd=...
export const checkUtilityReceiptLedgerEntries = async (req, res) => {
  try {
    const { propertyId, landlordId, periodStart, periodEnd } = req.query;
    const match = {
      status: "approved",
      category: { $in: ["UTILITY_RECEIPT_MANAGER", "UTILITY_RECEIPT_LANDLORD"] },
    };
    if (propertyId) match.property = propertyId;
    if (landlordId) match.landlord = landlordId;
    if (periodStart || periodEnd) {
      match.transactionDate = {};
      if (periodStart) match.transactionDate.$gte = new Date(periodStart);
      if (periodEnd) match.transactionDate.$lte = new Date(periodEnd);
    }
    const entries = await FinancialLedgerEntry.find(match).lean();
    res.json({ count: entries.length, entries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
