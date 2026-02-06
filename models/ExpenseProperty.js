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
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business' }
  },
  { timestamps: true }
);

export default mongoose.model("ExpenseProperty", ExpensePropertySchema);