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
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business' }
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

export default mongoose.model("RentPayment", RentPaymentSchema);