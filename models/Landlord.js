// models/Landlord.js
import mongoose from "mongoose";

const LandlordSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    idNumber: { type: String, required: true, unique: true },
    address: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    propertyCount: { type: Number, default: 0 },
    unitsCount: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 },
    status: { 
      type: String, 
      enum: ['active', 'inactive', 'suspended'], 
      default: 'active' 
    },
    profileImage: { type: String, default: "" },
    isAdmin: { type: Boolean, default: false },
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business' }
  },
  { timestamps: true }
);

export default mongoose.model("Landlord", LandlordSchema);