import mongoose from "mongoose";

const TenantInvoiceSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
      required: true,
      index: true,
    },
    landlord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Landlord",
      required: true,
      index: true,
    },
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    unit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Unit",
      required: true,
      index: true,
    },
    invoiceNumber: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    category: {
      type: String,
      enum: ["RENT_CHARGE", "UTILITY_CHARGE"],
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [0.01, "Amount must be positive"],
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    invoiceDate: {
      type: Date,
      required: true,
      index: true,
    },
    dueDate: {
      type: Date,
      required: true,
      validate: {
        validator(value) {
          return value >= this.invoiceDate;
        },
        message: "Due date must be after invoice date",
      },
    },
    status: {
      type: String,
      enum: ["pending", "paid", "partially_paid", "cancelled", "reversed"],
      default: "pending",
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    chartAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      required: true,
      index: true,
    },

    journalGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    ledgerEntries: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "FinancialLedgerEntry",
      },
    ],
    postingStatus: {
      type: String,
      enum: ["unposted", "posted", "failed", "reversed"],
      default: "unposted",
      index: true,
    },
    postingError: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

TenantInvoiceSchema.index({ business: 1, tenant: 1, invoiceDate: -1 });
TenantInvoiceSchema.index({ business: 1, property: 1, landlord: 1, invoiceDate: -1 });
TenantInvoiceSchema.index({ business: 1, invoiceNumber: 1 }, { unique: true });

export default mongoose.model("TenantInvoice", TenantInvoiceSchema);