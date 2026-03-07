import mongoose from "mongoose";

const CompanySettingsSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      unique: true,
    },

    // Utility Types - company-specific utilities
    utilityTypes: [
      {
        _id: mongoose.Schema.Types.ObjectId,
        name: { type: String, required: true }, // e.g., "Electricity", "Water", "Garbage"
        description: { type: String, default: "" },
        category: { type: String, enum: ["utility", "service_charge", "maintenance"], default: "utility" },
        isActive: { type: Boolean, default: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],

    // Billing Periods - company-specific billing cycles
    billingPeriods: [
      {
        _id: mongoose.Schema.Types.ObjectId,
        name: { type: String, required: true }, // e.g., "Monthly", "Quarterly", "Annually"
        durationInDays: { type: Number, required: true },
        durationInMonths: { type: Number, default: 0 },
        isActive: { type: Boolean, default: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],

    // Property Management Commissions - company-specific commission structures
    commissions: [
      {
        _id: mongoose.Schema.Types.ObjectId,
        name: { type: String, required: true }, // e.g., "Default", "Premium", "Budget"
        description: { type: String, default: "" },
        percentage: { type: Number, required: true }, // 0-100
        applicableTo: { type: String, enum: ["rent", "utilities", "all"], default: "rent" },
        recognitionBasis: { type: String, enum: ["received", "invoiced"], default: "received" },
        settlementBasis: { type: String, enum: ["received", "invoiced"], default: "received" },
        includeDirectLandlordPayments: { type: Boolean, default: true },
        provisionalRecognition: { type: Boolean, default: false },
        isActive: { type: Boolean, default: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],

    // Expense Items - company-specific expense categories
    expenseItems: [
      {
        _id: mongoose.Schema.Types.ObjectId,
        name: { type: String, required: true }, // e.g., "Repairs", "Cleaning", "Security"
        description: { type: String, default: "" },
        code: { type: String, unique: true, sparse: true }, // e.g., "EXP001"
        category: {
          type: String,
          enum: ["maintenance", "utilities", "staffing", "supplies", "other"],
          default: "other",
        },
        defaultAmount: { type: Number, default: 0 },
        isActive: { type: Boolean, default: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],

    // General Settings
    currencyCode: { type: String, default: "KES" },
    decimalPlaces: { type: Number, default: 2 },
    timezone: { type: String, default: "Africa/Nairobi" },
    dateFormat: { type: String, default: "DD/MM/YYYY" },

    // Status
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Indexes for performance
CompanySettingsSchema.index({ company: 1 });
CompanySettingsSchema.index({ "utilityTypes.isActive": 1 });
CompanySettingsSchema.index({ "billingPeriods.isActive": 1 });
CompanySettingsSchema.index({ "expenseItems.isActive": 1 });

export default mongoose.model("CompanySettings", CompanySettingsSchema);
