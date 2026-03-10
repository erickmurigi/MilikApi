const mongoose = require('mongoose');

const ReceiptSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    property: { type: mongoose.Schema.Types.ObjectId, ref: 'Property' },
    landlord: { type: mongoose.Schema.Types.ObjectId, ref: 'Landlord' },
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    unit: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', required: true },
    amount: { type: Number, required: true },
    paymentMethod: { type: String, enum: ['mobile_money', 'bank_transfer', 'cash', 'check', 'credit_card'], required: true },
    description: { type: String },
    receiptDate: { type: Date, required: true },
    receiptNumber: { type: String, unique: true },
    referenceNumber: { type: String },
    cashbook: { type: String, default: 'Main Cashbook' },
    paymentType: { type: String, enum: ['rent', 'deposit', 'utility', 'late_fee', 'other'], default: 'rent' },
    dueDate: { type: Date },
    isConfirmed: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    // Removed manual createdAt, updatedAt
  },
  { timestamps: true }
);

module.exports = mongoose.model('Receipt', ReceiptSchema);