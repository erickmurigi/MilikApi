// models/Maintenance.js
import mongoose from "mongoose";

const MaintenanceSchema = new mongoose.Schema(
  {
    unit: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Unit', 
      required: true 
    },
    tenant: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Tenant' 
    },
    title: { type: String, required: true },
    description: { type: String, required: true },
    priority: { 
      type: String, 
      enum: ['low', 'medium', 'high', 'emergency'],
      default: 'medium' 
    },
    status: { 
      type: String, 
      enum: ['pending', 'in_progress', 'completed', 'cancelled'],
      default: 'pending' 
    },
    assignedTo: { 
      type: String,                             
    },
    estimatedCost: { type: Number, default: 0 },
    actualCost: { type: Number, default: 0 },
    scheduledDate: { type: Date },
    completedDate: { type: Date },
    images: [{ type: String }],
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business' }
  },
  { timestamps: true }
);

export default mongoose.model("Maintenance", MaintenanceSchema);