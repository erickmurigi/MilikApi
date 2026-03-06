// routes/rentPayment.js
import express from "express"
import { 
  createPayment, 
  getPayment, 
  getPayments, 
  updatePayment, 
  deletePayment,
  confirmPayment,
  unconfirmPayment,
  getPaymentSummary 
} from "../../controllers/propertyController/rentPayment.js"
import { verifyUser } from "../../controllers/verifyToken.js"

const router = express.Router()

// Create payment
router.post("/", verifyUser, createPayment)

// Get all payments
router.get("/", verifyUser, getPayments)

// Get payment summary
router.get("/get/summary", verifyUser, getPaymentSummary)

// Get single payment
router.get("/:id", verifyUser, getPayment)

// Update payment
router.put("/:id", verifyUser, updatePayment)

// Delete payment
router.delete("/:id", verifyUser, deletePayment)

// Confirm payment
router.put("/confirm/:id", verifyUser, confirmPayment)

// Unconfirm payment - allows unconfirming to enable deletion
router.put("/unconfirm/:id", verifyUser, unconfirmPayment)

export default router