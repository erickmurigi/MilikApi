// models/Payment.js - Updated
import mongoose from "mongoose";

const RentPaymentSchema = new mongoose.Schema(
  {
    tenant: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Tenant', 
      required: true 
    },
    unit: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Unit', 
      required: true 
    },
    amount: { type: Number, required: true },
    paymentType: { 
      type: String, 
      enum: ['rent', 'deposit', 'utility', 'late_fee', 'other'],
      required: true 
    },
    paymentDate: { type: Date, required: true },
    bankingDate: { type: Date },
    recordDate: { type: Date },
    dueDate: { type: Date, required: true },
    referenceNumber: { type: String, required: true, unique: true },
    description: { type: String },
    isConfirmed: { type: Boolean, default: false },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Landlord' },
    confirmedAt: { type: Date },
    paymentMethod: { 
      type: String, 
      enum: ['bank_transfer', 'mobile_money', 'cash', 'check', 'credit_card'],
      required: true 
    },
    ledgerType: {
      type: String,
      enum: ['invoices', 'receipts', 'cashbook'],
      default: 'receipts'
    },
    isReversed: { type: Boolean, default: false },
    reversedAt: { type: Date },
    reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reversalReason: { type: String },
    reversalEntry: { type: mongoose.Schema.Types.ObjectId, ref: 'RentPayment' },
    reversalOf: { type: mongoose.Schema.Types.ObjectId, ref: 'RentPayment' },
    isCancellationEntry: { type: Boolean, default: false },
    isCancelled: { type: Boolean, default: false },
    cancelledAt: { type: Date },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancellationReason: { type: String },
    receiptNumber: { 
      type: String, 
      unique: true, 
      sparse: true,
      index: true 
    },
    month: { type: Number, required: true },
    year: { type: Number, required: true },
    utilities: [{
      utility: { type: mongoose.Schema.Types.ObjectId, ref: 'Utility' },
      amount: { type: Number }
    }],
    breakdown: {
      rent: { type: Number, default: 0 },
      utilities: [{
        utility: { type: mongoose.Schema.Types.ObjectId, ref: 'Utility' },
        name: { type: String },
        amount: { type: Number },
        billingCycle: { type: String }
      }],
      total: { type: Number }
    },
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
  },
  { timestamps: true }
);

// Pre-save hook to calculate breakdown total
RentPaymentSchema.pre('save', function(next) {
  if (!this.breakdown) {
    this.breakdown = {
      rent: 0,
      utilities: [],
      total: this.amount
    };
  }
  
  if (!this.breakdown.total) {
    const rentAmount = this.breakdown.rent || 0;
    const utilitiesTotal = this.breakdown.utilities.reduce((sum, util) => sum + (util.amount || 0), 0);
    this.breakdown.total = rentAmount + utilitiesTotal;
  }
  
  next();
});

// Indexes for better query performance
RentPaymentSchema.index({ business: 1 });
RentPaymentSchema.index({ business: 1, paymentDate: -1 });
RentPaymentSchema.index({ tenant: 1 });
RentPaymentSchema.index({ unit: 1 });
RentPaymentSchema.index({ paymentDate: -1 });
RentPaymentSchema.index({ referenceNumber: 1 }, { unique: true });
RentPaymentSchema.index({ receiptNumber: 1 }, { unique: true, sparse: true });
RentPaymentSchema.index({ year: -1, month: -1 });
RentPaymentSchema.index({ ledgerType: 1 });
RentPaymentSchema.index({ reversalOf: 1 });
RentPaymentSchema.index({ isCancelled: 1 });
RentPaymentSchema.index({ bankingDate: -1 });
RentPaymentSchema.index({ recordDate: -1 });

export default mongoose.model("RentPayment", RentPaymentSchema);