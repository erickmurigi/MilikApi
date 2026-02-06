// models/Property.js
import mongoose from "mongoose";

const PropertySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    address: { type: String },
    landlord: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Landlord', 
      default: null
    },
    propertyType: { 
      type: String, 
      enum: ['apartment', 'house', 'townhouse', 'commercial', 'mixed'],
      required: true 
    },
    totalUnits: { type: Number, default: 0 },
    occupiedUnits: { type: Number, default: 0 },
    vacantUnits: { type: Number, default: 0 },
    status: { 
      type: String, 
      enum: ['active', 'maintenance', 'closed'], 
      default: 'active' 
    },
    images: [{ type: String }],
    description: { type: String },
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business' }
  },
  { timestamps: true }
);

// Update unit counts when units change (optional hook)
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

export default mongoose.model("Property", PropertySchema);