// models/Lease.js
import mongoose from "mongoose";

const LeaseSchema = new mongoose.Schema(
  {
    tenant: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Tenant', 
      required: true 
    },
    unit: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Unit', 
      required: true 
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    rentAmount: { type: Number, required: true },
    depositAmount: { type: Number, required: true },
    paymentDueDay: { type: Number, required: true, min: 1, max: 28 },
    lateFee: { type: Number, default: 0 },
    terms: { type: String },
    status: { 
      type: String, 
      enum: ['active', 'expired', 'terminated', 'renewed'],
      default: 'active' 
    },
    documentUrl: { type: String },
    signedByTenant: { type: Boolean, default: false },
    signedByLandlord: { type: Boolean, default: false },
    signedDate: { type: Date },
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business' }
  },
  { timestamps: true }
);

export default mongoose.model("Lease", LeaseSchema);