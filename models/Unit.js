// models/Unit.js
import mongoose from "mongoose";

const UnitSchema = new mongoose.Schema(
  {
    unitNumber: { type: String, required: true },
    property: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Property', 
      required: true 
    },
    unitType: { 
      type: String, 
      enum: ['studio', '1bed', '2bed', '3bed', '4bed', 'commercial'],
      required: true 
    },
   
    rent: { type: Number, required: true },
    deposit: { type: Number, required: true },
    status: { 
      type: String, 
      enum: ['vacant', 'occupied', 'maintenance', 'reserved'],
      default: 'vacant' 
    },
    amenities: [{ type: String }],
    utilities: [{
      utility: { type: String },
      isIncluded: { type: Boolean, default: false },
      unitCharge: { type: Number, default: 0 }
    }],
    billingFrequency: { 
      type: String, 
      enum: ['monthly', 'bi-monthly', 'quarterly', 'semi-annually', 'annually'],
      default: 'monthly'
    },
    isVacant: { type: Boolean, default: true },
    lastTenant: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Tenant' 
    },
    vacantSince: { type: Date },
    daysVacant: { type: Number, default: 0 },
    lastPaymentDate: { type: Date },
    nextPaymentDate: { type: Date },
    images: [{ type: String }],
    description: { type: String },
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
  },
  { timestamps: true }
);

// Indexes for better query performance
UnitSchema.index({ business: 1 });
UnitSchema.index({ business: 1, status: 1 });
UnitSchema.index({ property: 1 });
UnitSchema.index({ property: 1, status: 1 });
UnitSchema.index({ unitNumber: 1, property: 1 }, { unique: true });
UnitSchema.index({ isVacant: 1 });

export default mongoose.model("Unit", UnitSchema);