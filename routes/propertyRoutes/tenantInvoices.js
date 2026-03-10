
import express from "express";
import { verifyUser } from "../../controllers/verifyToken.js";
import { createTenantInvoice } from "../../controllers/propertyController/tenantInvoices.js";
import TenantInvoice from "../../models/TenantInvoice.js";

const router = express.Router();

// Create tenant invoice
router.post("/", verifyUser, createTenantInvoice);

// Get tenant invoices by tenant id (for statement view)
router.get("/", verifyUser, async (req, res) => {
  const { tenant } = req.query;
  if (!tenant) {
    return res.status(400).json({ error: "Tenant id required" });
  }
  try {
    const invoices = await TenantInvoice.find({ tenant });
    res.status(200).json(invoices);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch tenant invoices" });
  }
});

export default router;
