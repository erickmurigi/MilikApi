import express from "express";
import { payLandlord, postCommission } from "../../controllers/propertyController/landlordPaymentController.js";
import { verifyToken } from "../../controllers/verifyToken.js";

const router = express.Router();

/**
 * POST /api/landlord-payments/pay
 * Record payment to landlord
 */
router.post("/pay", verifyToken, payLandlord);

/**
 * POST /api/landlord-payments/post-commission
 * Post commission income
 */
router.post("/post-commission", verifyToken, postCommission);

export default router;
