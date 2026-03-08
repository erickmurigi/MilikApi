// models/ProcessedStatement.js
import mongoose from "mongoose";

const ProcessedStatementSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    landlord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Landlord",
      required: true,
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
      required: true,
    },
    periodStart: {
      type: Date,
      required: true,
    },
    periodEnd: {
      type: Date,
      required: true,
    },
    statementType: {
      type: String,
      enum: ["provisional", "final"],
      default: "provisional",
    },
    // Statement summary data
    totalRentInvoiced: {
      type: Number,
      default: 0,
    },
    totalRentReceived: {
      type: Number,
      default: 0,
    },
    totalRentReceivedByManager: {
      type: Number,
      default: 0,
    },
    totalRentReceivedByLandlord: {
      type: Number,
      default: 0,
    },
    totalUtilitiesCollected: {
      type: Number,
      default: 0,
    },
    depositsHeldByManager: {
      type: Number,
      default: 0,
    },
    depositsHeldByLandlord: {
      type: Number,
      default: 0,
    },
    unappliedPayments: {
      type: Number,
      default: 0,
    },
    commissionPercentage: {
      type: Number,
      default: 0,
    },
    commissionBasis: {
      type: String,
      enum: ["invoiced", "received", "received_manager_only"],
      default: "received",
    },
    commissionAmount: {
      type: Number,
      default: 0,
    },
    netAmountDue: {
      type: Number,
      default: 0,
    },
    totalExpenses: {
      type: Number,
      default: 0,
    },
    recurringDeductions: {
      type: Number,
      default: 0,
    },
    advanceRecoveries: {
      type: Number,
      default: 0,
    },
    expensesByCategory: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    netAfterExpenses: {
      type: Number,
      default: 0,
    },
    isNegativeStatement: {
      type: Boolean,
      default: false,
    },
    amountPayableByLandlordToManager: {
      type: Number,
      default: 0,
    },
    summaryBuckets: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    financialEvents: [
      {
        eventType: { type: String },
        bucket: { type: String },
        amount: { type: Number, default: 0 },
        date: { type: Date },
        tenantId: { type: String },
        unit: { type: String },
        tenantName: { type: String },
        reference: { type: String },
        meta: { type: mongoose.Schema.Types.Mixed, default: {} },
      },
    ],
    occupiedUnits: {
      type: Number,
      default: 0,
    },
    vacantUnits: {
      type: Number,
      default: 0,
    },
    // Tenant details (stored as array for history)
    tenantRows: [
      {
        unit: String,
        tenantName: String,
        rentPerMonth: Number,
        openingBalance: Number,
        totalInvoiced: Number,
        txnNo: String,
        totalReceived: Number,
        closingBalance: Number,
      },
    ],
    // Payment status
    status: {
      type: String,
      enum: ["paid", "unpaid"],
      default: "unpaid",
    },
    amountPaid: {
      type: Number,
      default: 0,
    },
    paidDate: {
      type: Date,
      default: null,
    },
    paymentMethod: {
      type: String,
      enum: ["bank_transfer", "cash", "cheque", "mpesa", "paypal", "pesapal"],
      default: null,
    },
    paymentReference: {
      type: String,
      default: null,
    },
    // Admin notes
    notes: {
      type: String,
      default: null,
    },
    closedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    closedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Index for quick lookup
ProcessedStatementSchema.index({ business: 1, landlord: 1, property: 1, periodStart: 1 });
ProcessedStatementSchema.index({ business: 1, status: 1 });
ProcessedStatementSchema.index({ business: 1, closedAt: -1 });

export default mongoose.model("ProcessedStatement", ProcessedStatementSchema);
