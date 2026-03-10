import mongoose from 'mongoose';

const trialRequestSchema = new mongoose.Schema({
  name: String,
  email: { type: String, required: true, unique: true },
  phone: String,
  businessInfo: String,
  status: { type: String, enum: ['pending', 'contacted', 'converted'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('TrialRequest', trialRequestSchema);
