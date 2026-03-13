import express from "express";
import { verifyUser } from "../../controllers/verifyToken.js";
import { createTenantInvoice } from "../../controllers/propertyController/tenantInvoices.js";
import TenantInvoice from "../../models/TenantInvoice.js";

const router = express.Router();

// Create tenant invoice
router.post(
  "/",
  (req, res, next) => {
    console.log("ROUTE HANDLER: /api/tenant-invoices POST hit", req.body);
    next();
  },
  verifyUser,
  createTenantInvoice
);

// Get tenant invoices
// Supports:
//   /api/tenant-invoices?tenant=<tenantId>
//   /api/tenant-invoices?business=<businessId>
//   /api/tenant-invoices?tenant=<tenantId>&business=<businessId>
router.get("/", verifyUser, async (req, res) => {
  try {
    const { tenant, business, status } = req.query;

    const query = {};

    if (tenant) query.tenant = tenant;
    if (business) query.business = business;
    if (status) query.status = status;

    if (!tenant && !business) {
      return res.status(400).json({
        error: "At least tenant or business query parameter is required",
      });
    }

    const invoices = await TenantInvoice.find(query)
      .sort({ invoiceDate: 1, createdAt: 1 })
      .populate("tenant", "name tenantName firstName lastName")
      .populate("unit", "unitNumber name unitName")
      .populate("property", "propertyName name")
      .populate("chartAccount", "code name type");

    return res.status(200).json(invoices);
  } catch (err) {
    console.error("Failed to fetch tenant invoices:", err);
    return res.status(500).json({ error: "Failed to fetch tenant invoices" });
  }
});

export default router;