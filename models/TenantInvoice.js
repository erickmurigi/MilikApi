const mongoose = require('mongoose');

const TenantInvoiceSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    property: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true },
    landlord: { type: mongoose.Schema.Types.ObjectId, ref: 'Landlord', required: true },
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    unit: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', required: true },
    invoiceNumber: { type: String, required: true, unique: true },
    category: { type: String, enum: ['RENT_CHARGE', 'UTILITY_CHARGE'], required: true },
    amount: { 
      type: Number, 
      required: true,
      min: [0, 'Amount must be positive']
    },
    description: { type: String },
    invoiceDate: { type: Date, required: true },
    dueDate: { 
      type: Date, 
      required: true,
      validate: {
        validator: function(value) {
          return value >= this.invoiceDate;
        },
        message: 'Due date must be after invoice date'
      }
    },
    status: { type: String, enum: ['pending', 'paid', 'partially_paid'], default: 'pending' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    chartAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialLedgerEntry', required: true }
    // Remove manual createdAt, updatedAt
  },
  { timestamps: true }
);

module.exports = mongoose.model('TenantInvoice', TenantInvoiceSchema);