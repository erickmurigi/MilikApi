import mongoose from "mongoose";

const BusinessSchema = new mongoose.Schema({
  businessOwner: { type: String, required: true },
  phoneNo: { type: String },
  nationalID: { type: String, default: "" },
  businessPhoneNo: { type: String, default: "" },
  countyLocated: { type: String },
  areaLocated: { type: String, default: "" },
  businessName: { type: String, required: true },
  registrationNumber: { type: String, required: true, unique: true },
  businessType: { type: String, required: true },
  email: {type: String, required:true},
  model: { type: String, default: "" },
  isActive: { type: Boolean, default: false },
  hasWholesale: { type: Boolean, default: false },
  transferEnabled: { type: Boolean, default: false },
  linkId: { type: String, default: "" },
  kraPin: { type: String },
  currency: {
    type: String,
    enum: [
      "USD", "KES", "GBP", "JPY", "UGX", "TZS", "EUR", "RWF", "ETB",
      "AUD", "CAD", "CHF", "CNY", "NZD", "SGD", "HKD", "SEK", "INR",
      "ZAR", "GHS", "NAD", "NGN"
    ],
    default: "KES"
  },
  VATRights: { type: Boolean, default: false },
  email: { type: String, default: "" },
  Address: { type: String, default: "" },
  slogan: { type: String, default: "" },
  logo: { type: String, default: "" },
  POBOX: { type: String, default: "" },
  Street: { type: String, default: "" },
  City: { type: String, default: "" },
  accountType: { type: String, default: "Regular" },
  accountStatus: { type: String, default: "Active" },
  accountActive: { type: Boolean, default: true },
  isHome: { type: Boolean, default: true },
  isHrDepartment: { type: Boolean, default: true },
  isCustomers: { type: Boolean, default: true },
  isInventory: { type: Boolean, default: true },
  isPOS: { type: Boolean, default: true },
  isSales: { type: Boolean, default: true },
  isWholesale: { type: Boolean, default: true },
  isOlderSales: { type: Boolean, default: true },
  isSalesDocuments: { type: Boolean, default: true },
  isTransactions: { type: Boolean, default: true },
  isRooms: { type: Boolean, default: true },
  isPayroll: { type: Boolean, default: true },
  isTots: { type: Boolean, default: true },
  isReports: { type: Boolean, default: true },
  isSupplies: { type: Boolean, default: true },
  isExpenses: { type: Boolean, default: true },
  isStore: { type: Boolean, default: true },
  isDirectSales: { type: Boolean, default: true },
  currentSaleNumber: { type: Number, default: 0 },
   // Add these new fields for tracking
  lastSaleDate: { type: Date },
  isMarkedInactive: { type: Boolean, default: false },
  inactivityCheckDate: { type: Date },
  totalSalesCount: { type: Number, default: 0 },
  
  accessKeys: [{
    adminKey: { type: String, required: true, unique: true },
    normalKey: { type: String, required: true, unique: true },
    keyVersion: { type: String, default:"v1"}
  }]
}, { timestamps: true });


BusinessSchema.index({ "accessKeys.keyVersion": 1 });

export default mongoose.model("Business", BusinessSchema);