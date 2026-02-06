// models/Property.js
import mongoose from "mongoose";

const landlordSchema = new mongoose.Schema({
  name: { type: String, required: true },
  contact: { type: String },
  isPrimary: { type: Boolean, default: false }
}, { _id: true });

const standingChargeSchema = new mongoose.Schema({
  serviceCharge: { type: String, required: true },
  chargeMode: { 
    type: String, 
    enum: ['Monthly', 'Quarterly', 'Annual', 'One-time'],
    default: 'Monthly'
  },
  billingCurrency: {
    type: String,
    enum: ['KES', 'USD'],
    default: 'KES'
  },
  costPerArea: { type: String },
  chargeValue: { type: Number, default: 0 },
  vatRate: {
    type: String,
    enum: ['0%', '8%', '16%'],
    default: '16%'
  },
  escalatesWithRent: { type: Boolean, default: false }
});

const securityDepositSchema = new mongoose.Schema({
  depositType: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: {
    type: String,
    enum: ['KES', 'USD'],
    default: 'KES'
  },
  refundable: { type: Boolean, default: true },
  terms: { type: String }
});

const smsExemptionsSchema = new mongoose.Schema({
  all: { type: Boolean, default: false },
  invoice: { type: Boolean, default: false },
  general: { type: Boolean, default: false },
  receipt: { type: Boolean, default: false },
  balance: { type: Boolean, default: false }
}, { _id: false });

const emailExemptionsSchema = new mongoose.Schema({
  all: { type: Boolean, default: false },
  invoice: { type: Boolean, default: false },
  general: { type: Boolean, default: false },
  receipt: { type: Boolean, default: false },
  balance: { type: Boolean, default: false }
}, { _id: false });

const bankingDetailsSchema = new mongoose.Schema({
  drawerBank: { type: String, default: '' },
  bankBranch: { type: String, default: '' },
  accountName: { type: String, default: '' },
  accountNumber: { type: String, default: '' }
}, { _id: false });


const PropertySchema = new mongoose.Schema(
  {
    // General Information
    dateAcquired: { type: Date },
    letManage: {
      type: String,
      enum: ['Managing', 'Letting', 'Both'],
      default: 'Managing'
    },
    landlords: [landlordSchema],
    propertyCode: { 
      type: String, 
      required: true,
      unique: true 
    },
    propertyName: { 
      type: String, 
      required: true 
    },
    lrNumber: { type: String, required: true },
    category: { type: String },
    propertyType: {
      type: String,
      enum: [
        'Residential',
        'Commercial',
        'Mixed Use',
        'Industrial',
        'Agricultural',
        'Special Purpose',
        'apartment',
        'house',
        'townhouse',
        'commercial',
        'mixed'
      ],
      required: true
    },
    specification: {
      type: String,
      enum: [
        'Multi-Unit/Multi-Spa',
        'Single Storey',
        'Multi Storey',
        'High Rise',
        'Complex',
        'Estate'
      ]
    },
    multiStoreyType: {
      type: String,
      enum: ['Low Rise', 'Mid Rise', 'High Rise']
    },
    numberOfFloors: { type: Number, default: 0 },
    country: { 
      type: String, 
      default: 'Kenya' 
    },
    townCityState: { type: String },
    estateArea: { type: String },
    roadStreet: { type: String },
    zoneRegion: { type: String },
    
    // Location (from old model)
    address: { type: String },
    
    // Accounting & Billing
    accountLedgerType: { 
      type: String,
      default: 'Property Control Ledger In GL'
    },
    primaryBank: { type: String },
    alternativeTaxPin: { type: String },
    invoicePrefix: { type: String },
    invoicePaymentTerms: { 
      type: String,
      default: 'Please pay your invoice before due date to avoid penalty.'
    },
    mpesaPaybill: { type: Boolean, default: true },
    disableMpesaStkPush: { type: Boolean, default: false },
    mpesaNarration: { type: String },
    
    // Standing Charges & Deposits
    standingCharges: [standingChargeSchema],
    securityDeposits: [securityDepositSchema],
    
    // Communications
    smsExemptions: { 
      type: smsExemptionsSchema,
      default: () => ({})
    },
    emailExemptions: { 
      type: emailExemptionsSchema,
      default: () => ({})
    },
    
    // Preferences
    excludeFeeSummary: { type: Boolean, default: false },
    
    // Banking Details
    bankingDetails: {
      type: bankingDetailsSchema,
      default: () => ({})
    },
    
    // Notes & Additional Info
    notes: { type: String },
    specificContactInfo: { type: String },
    description: { type: String },
    
    // Unit Management
    totalUnits: { type: Number, default: 0 },
    occupiedUnits: { type: Number, default: 0 },
    vacantUnits: { type: Number, default: 0 },
    
    // Status
    status: { 
      type: String, 
      enum: ['active', 'maintenance', 'closed'], 
      default: 'active' 
    },
    
    // Media
    images: [{ type: String }],
    
    // Business Reference
    business: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Business',
      required: true 
    },
    
    // Audit fields
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Virtual for full address
PropertySchema.virtual('fullAddress').get(function() {
  const parts = [
    this.roadStreet,
    this.estateArea,
    this.townCityState,
    this.zoneRegion,
    this.country
  ].filter(part => part && part.trim() !== '');
  
  return parts.join(', ');
});

// Update unit counts when units change
PropertySchema.statics.updateUnitCounts = async function(propertyId) {
  const Unit = mongoose.model('Unit');
  
  const totalUnits = await Unit.countDocuments({ property: propertyId });
  const occupiedUnits = await Unit.countDocuments({ 
    property: propertyId, 
    status: 'occupied' 
  });
  const vacantUnits = await Unit.countDocuments({ 
    property: propertyId, 
    status: 'vacant' 
  });
  
  await this.findByIdAndUpdate(propertyId, {
    totalUnits,
    occupiedUnits,
    vacantUnits
  });
};

// Pre-save middleware to ensure at least one primary landlord
PropertySchema.pre('save', function(next) {
  if (this.landlords && this.landlords.length > 0) {
    // Mark first landlord as primary if none is marked
    const hasPrimary = this.landlords.some(landlord => landlord.isPrimary);
    if (!hasPrimary) {
      this.landlords[0].isPrimary = true;
    }
  }
  next();
});

// Indexes for better query performance
PropertySchema.index({ propertyCode: 1 }, { unique: true });
PropertySchema.index({ propertyName: 1 });
PropertySchema.index({ lrNumber: 1 });
PropertySchema.index({ status: 1 });
PropertySchema.index({ business: 1 });
PropertySchema.index({ zoneRegion: 1 });
PropertySchema.index({ 'landlords.name': 1 });

export default mongoose.model("Property", PropertySchema);