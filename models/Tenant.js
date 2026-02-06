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
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business' }
  },
  { timestamps: true }
);

export default mongoose.model("Tenant", TenantSchema);