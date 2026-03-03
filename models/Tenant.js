// models/Tenant.js
import mongoose from "mongoose";

const TenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
  
    phone: { type: String, required: true },
    idNumber: { type: String, required: true, unique: true },
    unit: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Unit', 
      required: true 
    },
    rent: { type: Number, required: true },
    balance: { type: Number, default: 0 },
    status: { 
      type: String, 
      enum: ['active', 'inactive', 'overdue', 'evicted', 'moved_out'],
      default: 'active' 
    },
    paymentMethod: { 
      type: String, 
      enum: ['bank_transfer', 'mobile_money', 'cash', 'check', 'credit_card'],
      required: true 
    },
    moveInDate: { type: Date, required: true },
    moveOutDate: { type: Date },
    emergencyContact: {
      name: { type: String },
      phone: { type: String },
      relationship: { type: String }
    },
    documents: [{
      name: { type: String },
      url: { type: String },
      uploadedAt: { type: Date, default: Date.now }
    }],
    profileImage: { type: String, default: "" },
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
  },
  { timestamps: true }
);

// Indexes for better query performance
TenantSchema.index({ business: 1 });
TenantSchema.index({ business: 1, status: 1 });
TenantSchema.index({ unit: 1 });
TenantSchema.index({ idNumber: 1 }, { unique: true });
TenantSchema.index({ phone: 1 });
TenantSchema.index({ moveInDate: -1 });

export default mongoose.model("Tenant", TenantSchema);