// controllers/rentPaymentController.js
import RentPayment from "../../models/RentPayment.js";
import Tenant from "../../models/Tenant.js";
import Unit from "../../models/Unit.js";


// Generate unique receipt number
const generateReceiptNumber = async (businessId) => {
  const prefix = "RCPT";
  const year = new Date().getFullYear().toString().slice(-2);
  const month = (new Date().getMonth() + 1).toString().padStart(2, '0');
  
  // Find the last receipt number for this business
  const lastPayment = await RentPayment.findOne(
    { 
      business: businessId,
      receiptNumber: { $regex: `^${prefix}-${year}${month}` }
    },
    { receiptNumber: 1 },
    { sort: { receiptNumber: -1 } }
  );
  
  let sequence = 1;
  if (lastPayment && lastPayment.receiptNumber) {
    const lastSeq = parseInt(lastPayment.receiptNumber.split('-')[2]) || 0;
    sequence = lastSeq + 1;
  }
  
  return `${prefix}-${year}${month}-${sequence.toString().padStart(4, '0')}`;
};

// Create payment
export const createPayment = async (req, res, next) => {
    try {
        // Generate reference number
        const refNumber = `PAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        
        // Generate receipt number if not provided
        let receiptNumber = req.body.receiptNumber;
        if (!receiptNumber || receiptNumber.trim() === '') {
            receiptNumber = await generateReceiptNumber(req.body.business);
        }
        
        const newPayment = new RentPayment({
            ...req.body,
            referenceNumber: refNumber,
            receiptNumber: receiptNumber,
            business: req.body.business
        });
        
        const savedPayment = await newPayment.save();
        
        // If payment is confirmed, update tenant balance
        if (savedPayment.isConfirmed) {
            await updateTenantBalance(savedPayment);
        }
        
        res.status(200).json(savedPayment);
    } catch (err) {
        next(err);
    }
};

// Get all payments
export const getPayments = async(req, res, next) => {
    const { business, tenant, unit, month, year, paymentType } = req.query;
    try {
        const filter = { business };
        if (tenant) filter.tenant = tenant;
        if (unit) filter.unit = unit;
        if (month) filter.month = parseInt(month);
        if (year) filter.year = parseInt(year);
        if (paymentType) filter.paymentType = paymentType;
        
        const payments = await RentPayment.find(filter)
            .populate('tenant', 'name email phone')
            .populate('unit', 'unitNumber')
            .populate('confirmedBy', 'name')
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
            .populate('confirmedBy', 'name');
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

// Delete payment
export const deletePayment = async(req, res, next) => {
    try {
        const payment = await RentPayment.findById(req.params.id);
        if (!payment) return res.status(404).json({ message: "Payment not found" });
        
        // If payment was confirmed, reverse the tenant balance
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