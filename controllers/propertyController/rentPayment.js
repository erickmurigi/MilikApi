// controllers/rentPaymentController.js
import RentPayment from "../../models/RentPayment.js";
import Tenant from "../../models/Tenant.js";
import Unit from "../../models/Unit.js";
import Property from "../../models/Property.js";
import { emitToCompany } from "../../utils/socketManager.js";
import { postEntry, postReversal } from "../../services/ledgerPostingService.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";


// Generate unique sequential receipt number
const generateReceiptNumber = async (businessId) => {
  const prefix = "REC";
  
  // Find the highest receipt number for this business
  const lastPayment = await RentPayment.findOne(
    { 
      business: businessId,
      receiptNumber: { $regex: `^${prefix}\\d+$` }
    },
    { receiptNumber: 1 },
    { sort: { createdAt: -1 } }
  );
  
  let sequence = 1;
  if (lastPayment && lastPayment.receiptNumber) {
    const numericPart = parseInt(lastPayment.receiptNumber.replace(`${prefix}`, '')) || 0;
    sequence = numericPart + 1;
  }
  
  return `${prefix}${sequence.toString().padStart(5, '0')}`;
};

const getStatementPeriodFromPayment = (payment) => {
    const paymentDate = payment?.paymentDate ? new Date(payment.paymentDate) : new Date();
    const fallbackMonth = paymentDate.getMonth() + 1;
    const fallbackYear = paymentDate.getFullYear();

    const month = Number(payment?.month || fallbackMonth);
    const year = Number(payment?.year || fallbackYear);

    const start = new Date(year, Math.max(month - 1, 0), 1, 0, 0, 0, 0);
    const end = new Date(year, Math.max(month, 1), 0, 23, 59, 59, 999);
    return { start, end };
};

const resolveLedgerCategory = (payment) => {
    if (payment?.paymentType !== "rent") return null;
    const paidDirect = !!payment?.paidDirectToLandlord;
    return paidDirect ? "RENT_RECEIPT_LANDLORD" : "RENT_RECEIPT_MANAGER";
};

const resolveLedgerReceiver = (payment) => {
    return payment?.paidDirectToLandlord ? "landlord" : "manager";
};

const resolvePropertyAndLandlord = async (payment) => {
    const unit = await Unit.findById(payment.unit).select("property").lean();
    if (!unit?.property) return { propertyId: null, landlordId: null };

    const property = await Property.findById(unit.property).select("landlords").lean();
    if (!property) return { propertyId: unit.property, landlordId: null };

    const landlords = Array.isArray(property.landlords) ? property.landlords : [];
    const primary = landlords.find((item) => item?.isPrimary && item?.landlordId);
    const fallback = landlords.find((item) => item?.landlordId);
    const landlordId = primary?.landlordId || fallback?.landlordId || null;

    return {
        propertyId: unit.property,
        landlordId,
    };
};

const tryPostPaymentLedgerEntry = async (payment, userId) => {
    const category = resolveLedgerCategory(payment);
    if (!category) return null;

    const { propertyId, landlordId } = await resolvePropertyAndLandlord(payment);
    if (!propertyId || !landlordId) {
        console.warn("Skipping ledger post: missing property/landlord context", {
            paymentId: String(payment?._id || ""),
            propertyId,
            landlordId,
        });
        return null;
    }

    const { start, end } = getStatementPeriodFromPayment(payment);
    const txDate = payment?.paymentDate ? new Date(payment.paymentDate) : new Date();

    return postEntry({
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
        amount: Math.abs(Number(payment.amount || 0)),
        direction: "credit",
        payer: "tenant",
        receiver: resolveLedgerReceiver(payment),
        notes: `Auto-posted from receipt ${payment.receiptNumber || payment.referenceNumber || payment._id}`,
        metadata: {
            paymentType: payment.paymentType,
            paymentMethod: payment.paymentMethod,
            paidDirectToLandlord: !!payment.paidDirectToLandlord,
            receiptNumber: payment.receiptNumber || null,
            referenceNumber: payment.referenceNumber || null,
        },
        createdBy: userId,
        approvedBy: userId,
        approvedAt: new Date(),
        status: "approved",
    });
};

/**
 * Helper: Reverse ledger entry when a payment is reversed
 * Non-breaking: logs error but does not throw
 * Idempotent: checks if reversal already exists before creating new one
 */
const tryReverseLedgerEntry = async (payment, userId, reason) => {
    try {
        // Find the original ledger entry for this payment
        const originalLedgerEntry = await FinancialLedgerEntry.findOne({
            sourceTransactionType: "rent_payment",
            sourceTransactionId: payment._id,
            category: { $ne: "REVERSAL" }, // Exclude existing reversals
            reversedByEntry: null
        });

        if (!originalLedgerEntry) {
            console.log(`[tryReverseLedgerEntry] No ledger entry found for payment ${payment._id}, skipping ledger reversal`);
            return;
        }

        // Idempotency check: ensure reversal doesn't already exist
        const existingReversal = await FinancialLedgerEntry.findOne({
            reversalOf: originalLedgerEntry._id,
            category: "REVERSAL"
        });

        if (existingReversal) {
            console.log(`[tryReverseLedgerEntry] Reversal already exists for ledger entry ${originalLedgerEntry._id}, skipping duplicate reversal`);
            return;
        }

        // Post the reversal
        const reversalResult = await postReversal({
            entryId: originalLedgerEntry._id,
            reason: reason || "Payment reversed",
            userId: userId
        });

        console.log(`[tryReverseLedgerEntry] Ledger reversal created for payment ${payment._id}:`, reversalResult.reversalEntry._id);
    } catch (error) {
        console.error(`[tryReverseLedgerEntry] Failed to reverse ledger entry for payment ${payment._id}:`, error);
        // Non-breaking: do not throw
    }
};

// Create payment
export const createPayment = async (req, res, next) => {
    try {
        // Security: Use authenticated user's company, not client-provided business
        const businessId = req.user.company;
        
        // Generate reference number
        const refNumber = req.body?.referenceNumber?.trim() || `PAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        
        // Generate receipt number if not provided
        let receiptNumber = req.body.receiptNumber;
        if (!receiptNumber || receiptNumber.trim() === '') {
            receiptNumber = await generateReceiptNumber(businessId);
        }
        
        const newPayment = new RentPayment({
            ...req.body,
            referenceNumber: refNumber,
            receiptNumber: receiptNumber,
            bankingDate: req.body?.bankingDate || req.body?.paymentDate,
            recordDate: req.body?.recordDate || new Date(),
            business: businessId
        });
        
        const savedPayment = await newPayment.save();
        
        // If payment is confirmed, update tenant balance
        if (savedPayment.isConfirmed) {
            await updateTenantBalance(savedPayment);
            try {
                const actorId = req.user?._id || req.user?.id;
                if (actorId) {
                    await tryPostPaymentLedgerEntry(savedPayment, actorId);
                }
            } catch (ledgerErr) {
                console.error("Ledger auto-post failed on createPayment:", ledgerErr?.message || ledgerErr);
            }
        }
        
        // Emit real-time socket event to company
        emitToCompany(businessId, 'payment:new', savedPayment);
        
        res.status(200).json(savedPayment);
    } catch (err) {
        next(err);
    }
};

// Get all payments
export const getPayments = async(req, res, next) => {
    const { tenant, unit, month, year, paymentType, ledger } = req.query;
    try {
        // Security: Use authenticated user's company (system admins can query across companies)
        const business = req.user.isSystemAdmin && req.query.business ? req.query.business : req.user.company;
        const filter = { business };
        if (tenant) filter.tenant = tenant;
        if (unit) filter.unit = unit;
        if (month) filter.month = parseInt(month);
        if (year) filter.year = parseInt(year);
        if (paymentType) filter.paymentType = paymentType;
        if (ledger) filter.ledgerType = ledger;
        
        const payments = await RentPayment.find(filter)
            .populate('tenant', 'name email phone')
            .populate('unit', 'unitNumber property')
            .populate('confirmedBy', 'surname otherNames email')
            .sort({ paymentDate: -1 });
        res.status(200).json(payments);
    } catch (err) {
        next(err);
    }
}

// Get single payment
export const getPayment = async(req, res, next) => {
    try {
        const payment = await RentPayment.findById(req.params.id)
            .populate('tenant', 'name email phone unit')
            .populate('unit', 'unitNumber property')
            .populate('confirmedBy', 'surname otherNames email');
        if (!payment) return res.status(404).json({ message: "Payment not found" });
        res.status(200).json(payment);
    } catch (err) {
        next(err);
    }
}

// Update payment
export const updatePayment = async(req, res, next) => {
    try {
        const payment = await RentPayment.findById(req.params.id);
        if (!payment) return res.status(404).json({ message: "Payment not found" });
        
        const updatedPayment = await RentPayment.findByIdAndUpdate(
            req.params.id,
            { $set: req.body },
            { new: true }
        );
        
        // If payment confirmation status changed, update tenant balance
        if (payment.isConfirmed !== updatedPayment.isConfirmed) {
            await updateTenantBalance(updatedPayment);
        }
        
        res.status(200).json(updatedPayment);
    } catch (err) {
        next(err);
    }
}

// Confirm payment
export const confirmPayment = async(req, res, next) => {
    try {
        const { confirmedBy } = req.body;

        const existingPayment = await RentPayment.findById(req.params.id);
        if (!existingPayment) return res.status(404).json({ message: "Payment not found" });
        if (existingPayment.isConfirmed) {
            return res.status(200).json(existingPayment);
        }
        
        const updatedPayment = await RentPayment.findByIdAndUpdate(
            req.params.id,
            { 
                $set: { 
                    isConfirmed: true,
                    confirmedBy,
                    confirmedAt: new Date()
                }
            },
            { new: true }
        );
        
        // Update tenant balance
        await updateTenantBalance(updatedPayment);

        try {
            const actorId = req.user?._id || req.user?.id || confirmedBy;
            if (actorId) {
                await tryPostPaymentLedgerEntry(updatedPayment, actorId);
            }
        } catch (ledgerErr) {
            console.error("Ledger auto-post failed on confirmPayment:", ledgerErr?.message || ledgerErr);
        }
        
        res.status(200).json(updatedPayment);
    } catch (err) {
        next(err);
    }
}

// Unconfirm payment - allows unconfirming a confirmed receipt to delete it
export const unconfirmPayment = async(req, res, next) => {
    try {
        const payment = await RentPayment.findById(req.params.id);
        if (!payment) return res.status(404).json({ message: "Payment not found" });
        
        if (!payment.isConfirmed) {
            return res.status(400).json({
                success: false,
                message: "This payment is not confirmed. Cannot unconfirm an unconfirmed payment."
            });
        }
        
        const updatedPayment = await RentPayment.findByIdAndUpdate(
            req.params.id,
            { 
                $set: { 
                    isConfirmed: false,
                    confirmedBy: null,
                    confirmedAt: null
                }
            },
            { new: true }
        );
        
        // Update tenant balance
        await updateTenantBalance(updatedPayment);
        
        res.status(200).json({
            success: true,
            message: "Payment unconfirmed successfully. You can now delete this receipt.",
            data: updatedPayment
        });
    } catch (err) {
        next(err);
    }
}

// Delete payment
export const deletePayment = async(req, res, next) => {
    try {
        const payment = await RentPayment.findById(req.params.id);
        if (!payment) return res.status(404).json({ message: "Payment not found" });
        
        // Prevent deletion of confirmed payments/receipts
        if (payment.isConfirmed) {
            return res.status(400).json({
                success: false,
                message: "Cannot delete a confirmed payment/receipt. Please unconfirm it first or contact support."
            });
        }
        
        // Prevent deletion of receipts with receipt numbers
        if (payment.receiptNumber) {
            return res.status(400).json({
                success: false,
                message: "Cannot delete a payment with a receipt number. Receipts are permanent records."
            });
        }
        
        // Legacy code (should not reach here if payment is confirmed)
        if (payment.isConfirmed) {
            const tenant = await Tenant.findById(payment.tenant);
            if (tenant) {
                tenant.balance += payment.amount; // Add back the amount
                await tenant.save();
            }
        }
        
        await RentPayment.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: "Payment deleted successfully" });
    } catch (err) {
        next(err);
    }
}

// Get payment summary
export const getPaymentSummary = async(req, res, next) => {
    const { business, month, year } = req.query;
    try {
        const filter = { business, isConfirmed: true };
        if (month) filter.month = parseInt(month);
        if (year) filter.year = parseInt(year);
        
        const payments = await RentPayment.find(filter);
        
        const totalRent = payments
            .filter(p => p.paymentType === 'rent')
            .reduce((sum, p) => sum + p.amount, 0);
            
        const totalDeposits = payments
            .filter(p => p.paymentType === 'deposit')
            .reduce((sum, p) => sum + p.amount, 0);
            
        const totalUtilities = payments
            .filter(p => p.paymentType === 'utility')
            .reduce((sum, p) => sum + p.amount, 0);
            
        const totalLateFees = payments
            .filter(p => p.paymentType === 'late_fee')
            .reduce((sum, p) => sum + p.amount, 0);
        
        res.status(200).json({
            totalPayments: payments.length,
            totalAmount: totalRent + totalDeposits + totalUtilities + totalLateFees,
            breakdown: {
                rent: totalRent,
                deposits: totalDeposits,
                utilities: totalUtilities,
                lateFees: totalLateFees
            },
            month: month || 'All',
            year: year || 'All'
        });
    } catch (err) {
        next(err);
    }
}

// Helper function to update tenant balance
const updateTenantBalance = async(payment) => {
    if (!payment.isConfirmed || payment.paymentType !== 'rent') return;
    
    const tenant = await Tenant.findById(payment.tenant);
    if (tenant) {
        // For rent payments, reduce the balance
        tenant.balance -= payment.amount;
        if (tenant.balance <= 0 && tenant.status === 'overdue') {
            tenant.status = 'active';
        }
        await tenant.save();
    }
}

// Reverse confirmed payment/receipt (audit-safe alternative to delete)
export const reversePayment = async(req, res, next) => {
    try {
        const payment = await RentPayment.findById(req.params.id);
        if (!payment) return res.status(404).json({ message: "Payment not found" });

        if (!payment.isConfirmed) {
            return res.status(400).json({
                success: false,
                message: "Only confirmed receipts can be reversed"
            });
        }

        if (payment.isReversed) {
            return res.status(400).json({
                success: false,
                message: "Receipt is already reversed"
            });
        }

        const reason = req.body?.reason || "Receipt reversed";
        const businessId = payment.business || req.user.company;
        const reversedBy = req.user?._id || req.user?.id || null;

        const reversalReceiptNumber = await generateReceiptNumber(businessId);
        const reversalRef = `REV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        const reversalPayload = {
            tenant: payment.tenant,
            unit: payment.unit,
            amount: -(Math.abs(payment.amount || 0)),
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
            ledgerType: 'cashbook',
            reversalOf: payment._id
        };

        const reversalEntry = await new RentPayment(reversalPayload).save();

        payment.isReversed = true;
        payment.reversedAt = new Date();
        payment.reversedBy = reversedBy;
        payment.reversalReason = reason;
        payment.reversalEntry = reversalEntry._id;
        await payment.save();

        // Apply tenant balance update through existing helper (negative amount adds balance back)
        await updateTenantBalance(reversalEntry);

        // Post ledger reversal entry (non-breaking, idempotent)
        await tryReverseLedgerEntry(payment, reversedBy, reason);

        emitToCompany(businessId, 'payment:reversed', {
            paymentId: payment._id,
            reversalId: reversalEntry._id
        });

        const populatedOriginal = await RentPayment.findById(payment._id)
            .populate('tenant', 'name email phone')
            .populate('unit', 'unitNumber')
            .populate('reversalEntry');

        res.status(200).json({
            success: true,
            message: 'Receipt reversed successfully',
            data: {
                original: populatedOriginal,
                reversal: reversalEntry
            }
        });
    } catch (err) {
        next(err);
    }
}

// Cancel a previous reversal and restore original receipt allocation effect
export const cancelReversal = async(req, res, next) => {
    try {
        const payment = await RentPayment.findById(req.params.id);
        if (!payment) return res.status(404).json({ message: "Payment not found" });

        if (!payment.isReversed || !payment.reversalEntry) {
            return res.status(400).json({
                success: false,
                message: "Receipt does not have an active reversal"
            });
        }

        const reversalEntry = await RentPayment.findById(payment.reversalEntry);
        if (!reversalEntry) {
            return res.status(404).json({
                success: false,
                message: "Reversal entry not found"
            });
        }

        if (reversalEntry.isCancelled) {
            return res.status(400).json({
                success: false,
                message: "Reversal is already cancelled"
            });
        }

        const businessId = payment.business || req.user.company;
        const cancelledBy = req.user?._id || req.user?.id || null;
        const reason = req.body?.reason || "Reversal cancelled; allocation restored";
        const wasConfirmed = reversalEntry.isConfirmed === true;

        reversalEntry.isCancelled = true;
        reversalEntry.cancelledAt = new Date();
        reversalEntry.cancelledBy = cancelledBy;
        reversalEntry.cancellationReason = reason;
        reversalEntry.isCancellationEntry = true;
        reversalEntry.isConfirmed = false;
        reversalEntry.confirmedAt = null;
        reversalEntry.confirmedBy = null;
        await reversalEntry.save();

        payment.isReversed = false;
        payment.reversedAt = null;
        payment.reversedBy = null;
        payment.reversalReason = null;
        payment.reversalEntry = null;
        await payment.save();

        // Remove reversal's impact from balance/allocation logic by applying a positive amount back
        if (wasConfirmed) {
            await updateTenantBalance({
                isConfirmed: true,
                paymentType: reversalEntry.paymentType,
                tenant: reversalEntry.tenant,
                amount: Math.abs(Number(reversalEntry.amount || 0))
            });
        }

        emitToCompany(businessId, 'payment:reversal_cancelled', {
            paymentId: payment._id,
            reversalId: reversalEntry._id
        });

        const populatedOriginal = await RentPayment.findById(payment._id)
            .populate('tenant', 'name email phone')
            .populate('unit', 'unitNumber');

        const populatedReversal = await RentPayment.findById(reversalEntry._id)
            .populate('tenant', 'name email phone')
            .populate('unit', 'unitNumber');

        res.status(200).json({
            success: true,
            message: 'Reversal cancelled successfully. Receipt allocation restored.',
            data: {
                original: populatedOriginal,
                reversal: populatedReversal
            }
        });
    } catch (err) {
        next(err);
    }
}