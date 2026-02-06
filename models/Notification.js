// models/Notification.js
import mongoose from "mongoose";

const NotificationSchema = new mongoose.Schema(
  {
    recipient: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Landlord', 
      required: true 
    },
    type: { 
      type: String, 
      enum: ['payment_due', 'payment_received', 'maintenance_request', 'tenant_move_in', 'tenant_move_out', 'lease_expiry', 'system'],
      required: true 
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    relatedId: { type: mongoose.Schema.Types.ObjectId },
    relatedType: { type: String },
    isRead: { type: Boolean, default: false },
    priority: { 
      type: String, 
      enum: ['low', 'medium', 'high'],
      default: 'medium' 
    },
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business' }
  },
  { timestamps: true }
);

export default mongoose.model("Notification", NotificationSchema);