// models/Expense.js
import mongoose from "mongoose";

const ExpensePropertySchema = new mongoose.Schema(
  {
    property: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Property' 
    },
    unit: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Unit' 
    },
    category: { 
      type: String, 
      enum: ['maintenance', 'repair', 'utility', 'tax', 'insurance', 'supplies', 'other'],
      required: true 
    },
    amount: { type: Number, required: true },
    description: { type: String, required: true },
    date: { type: Date, required: true },
    receiptNumber: { type: String },
    receiptImage: { type: String },
    paidBy: { type: String },
    paymentMethod: { 
      type: String, 
      enum: ['bank_transfer', 'mobile_money', 'cash', 'check', 'credit_card'] 
    },
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
  },
  { timestamps: true }
);

// Indexes for better query performance
ExpensePropertySchema.index({ business: 1 });
ExpensePropertySchema.index({ business: 1, date: -1 });
ExpensePropertySchema.index({ property: 1 });
ExpensePropertySchema.index({ unit: 1 });
ExpensePropertySchema.index({ category: 1 });
ExpensePropertySchema.index({ date: -1 });

export default mongoose.model("ExpenseProperty", ExpensePropertySchema);