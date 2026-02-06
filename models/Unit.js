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
      utility: { type: mongoose.Schema.Types.ObjectId, ref: 'Utility' },
      isIncluded: { type: Boolean, default: false },
      unitCharge: { type: Number, default: 0 }
    }],
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
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business' }
  },
  { timestamps: true }
);

export default mongoose.model("Unit", UnitSchema);