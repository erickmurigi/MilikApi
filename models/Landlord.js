// models/Landlord.js
import mongoose from "mongoose";

const LandlordSchema = new mongoose.Schema(
  {
    // General Information
    landlordCode: { 
      type: String, 
      required: true,
      unique: true,
      default: () => `LL${String(Date.now()).slice(-6)}`
    },
    landlordType: { 
      type: String, 
      enum: ['Individual', 'Company', 'Partnership', 'Trust'],
      required: true,
      default: 'Individual'
    },
    landlordName: { 
      type: String, 
      required: true 
    },
    regId: { 
      type: String, 
      required: true 
    },
    taxPin: { 
      type: String, 
      required: true 
    },
    status: { 
      type: String, 
      enum: ['Active', 'Archived'],
      default: 'Active' 
    },
    portalAccess: { 
      type: String, 
      enum: ['Enabled', 'Disabled'],
      default: 'Disabled' 
    },
    
    // Address Information
    postalAddress: { type: String, default: '' },
    email: { 
      type: String, 
      required: true,
      lowercase: true
    },
    phoneNumber: { 
      type: String, 
      required: true 
    },
    location: { type: String, default: '' },
    
    // Attachments (metadata only - files handled separately)
    attachments: [
      {
        id: String,
        name: String,
        size: String,
        dateTime: String,
        url: String // URL to stored file
      }
    ],
    
    // System fields
    propertyCount: { type: Number, default: 0 },
    unitsCount: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 },
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

// Indexes for better querying
LandlordSchema.index({ email: 1 });
LandlordSchema.index({ company: 1 });

export default mongoose.model("Landlord", LandlordSchema);