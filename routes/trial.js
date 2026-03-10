import express from 'express';
import TrialRequest from '../models/TrialRequest.js';

const router = express.Router();

// Free trial signup endpoint
router.post('/trial', async (req, res) => {
  const { name, email, phone, businessInfo } = req.body;
  try {
    const trial = new TrialRequest({ name, email, phone, businessInfo });
    await trial.save();
    res.status(201).json({ success: true, message: 'Trial request submitted' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

export default router;
