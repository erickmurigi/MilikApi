// controllers/rentPaymentController.js
import RentPayment from "../../models/RentPayment.js";
import Tenant from "../../models/Tenant.js";
import Unit from "../../models/Unit.js";
import { emitToCompany } from "../../utils/socketManager.js";


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