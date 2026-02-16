import mongoose from 'mongoose';

const companySchema = new mongoose.Schema({
  // General Information
  companyName: { type: String, required: true },
  registrationNo: { type: String },
  taxPIN: { type: String },
  taxExemptCode: { type: String },

  // Address
  postalAddress: { type: String, required: true },
  country: { type: String, default: 'Kenya' },
  town: { type: String },
  roadStreet: { type: String },
  latitude: { type: String },
  longitude: { type: String },

  // Currency & Statutory
  baseCurrency: { type: String, required: true, default: 'KES' },
  taxRegime: { type: String, required: true, default: 'VAT' },

  // Module Settings – stored as boolean flags
  modules: {
    propertyManagement: { type: Boolean, default: false },
    inventory: { type: Boolean, default: false },
    telcoDealership: { type: Boolean, default: false },
    procurement: { type: Boolean, default: false },
    hr: { type: Boolean, default: false },
    facilityManagement: { type: Boolean, default: false },
    hotelManagement: { type: Boolean, default: false },
    accounts: { type: Boolean, default: true },      // core module
    billing: { type: Boolean, default: true },       // core module
    propertySale: { type: Boolean, default: false },
    frontOffice: { type: Boolean, default: false },
    dms: { type: Boolean, default: false },
    academics: { type: Boolean, default: false },
    projectManagement: { type: Boolean, default: false },
    assetValuation: { type: Boolean, default: false },
  },

  // Fiscal Period Settings
  fiscalStartMonth: { type: String, required: true, default: 'January' },
  fiscalStartYear: { type: Number, required: true },
  fiscalPeriods: {
    monthly: { type: Boolean, default: true },
    quarterly: { type: Boolean, default: false },
    fourMonths: { type: Boolean, default: false },
    semiAnnual: { type: Boolean, default: false },
  },
  operationPeriodType: { type: String, required: true, default: 'Monthly' },

  // Additional fields from original Business schema
  businessOwner: { type: String },        // person who created/owns the company
  email: { type: String },
  phoneNo: { type: String },
  kraPin: { type: String },                // may duplicate taxPIN – keep for compatibility
  slogan: { type: String, default: '' },
  logo: { type: String, default: '' },
  POBOX: { type: String, default: '' },
  Street: { type: String, default: '' },
  City: { type: String, default: '' },

  // Access keys for multi‑tenant authentication
  accessKeys: [{
    adminKey: { type: String, required: true, unique: true },
    normalKey: { type: String, required: true, unique: true },
    keyVersion: { type: String, default: 'v1' }
  }],

  // Status flags
  isActive: { type: Boolean, default: false },
  accountActive: { type: Boolean, default: true },
  accountStatus: { type: String, default: 'Active' },

}, { timestamps: true });

// Indexes for performance
companySchema.index({ 'accessKeys.keyVersion': 1 });
companySchema.index({ registrationNo: 1 }, { unique: true, sparse: true });

export default mongoose.model('Company', companySchema);