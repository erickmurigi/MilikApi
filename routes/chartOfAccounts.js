import express from "express";
import mongoose from "mongoose";
import { verifyUser } from "../controllers/verifyToken.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import TenantInvoice from "../models/TenantInvoice.js";
import {
  ensureSystemChartOfAccounts,
  findChartOfAccounts,
  normalizeChartAccountPayload,
} from "../services/chartOfAccountsService.js";

const router = express.Router();

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const PROTECTED_CODES = new Set(["1200", "4100", "4102"]);

const resolveBusiness = (req) => req.query.business || req.body.business || req.user?.company || null;

router.get("/", verifyUser, async (req, res) => {
  try {
    const business = resolveBusiness(req);

    if (!business) {
      return res.status(400).json({
        error: "business query parameter is required",
      });
    }

    const accounts = await findChartOfAccounts({
      businessId: business,
      code: req.query.code || null,
      type: req.query.type || null,
      group: req.query.group || null,
      search: req.query.search || null,
    });

    return res.status(200).json(accounts);
  } catch (err) {
    console.error("Failed to fetch ChartOfAccounts:", err);
    return res.status(500).json({
      error: err?.message || "Failed to fetch ChartOfAccounts",
    });
  }
});

router.post("/", verifyUser, async (req, res) => {
  try {
    const business = resolveBusiness(req);

    if (!business) {
      return res.status(400).json({ error: "business is required" });
    }

    const payload = normalizeChartAccountPayload(req.body);

    if (!payload.code || !payload.name || !payload.type) {
      return res.status(400).json({
        error: "code, name and type are required",
      });
    }

    await ensureSystemChartOfAccounts(business);

    const existing = await ChartOfAccount.findOne({
      business,
      code: payload.code,
    }).lean();

    if (existing) {
      return res.status(409).json({
        error: "Account code already exists for this business",
      });
    }

    let parentAccount = null;
    let level = 0;

    if (payload.parentAccount) {
      if (!isValidObjectId(payload.parentAccount)) {
        return res.status(400).json({
          error: "parentAccount must be a valid account id",
        });
      }

      parentAccount = await ChartOfAccount.findOne({
        _id: payload.parentAccount,
        business,
      });

      if (!parentAccount) {
        return res.status(404).json({
          error: "Parent account not found for this business",
        });
      }

      level = Number(parentAccount.level || 0) + 1;
    }

    const account = await ChartOfAccount.create({
      business,
      code: payload.code,
      name: payload.name,
      type: payload.type,
      group: payload.group,
      subGroup: payload.subGroup,
      parentAccount: parentAccount?._id || null,
      level,
      isHeader: payload.isHeader,
      isPosting: payload.isHeader ? false : payload.isPosting,
      isSystem: false,
      balance: 0,
    });

    const populated = await ChartOfAccount.findById(account._id).populate("parentAccount", "code name");
    return res.status(201).json(populated);
  } catch (err) {
    console.error("Failed to create ChartOfAccount:", err);
    return res.status(500).json({
      error: err?.message || "Failed to create ChartOfAccount",
    });
  }
});

router.put("/:id", verifyUser, async (req, res) => {
  try {
    const business = resolveBusiness(req);
    const { id } = req.params;

    if (!business) {
      return res.status(400).json({ error: "business is required" });
    }

    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid chart account id" });
    }

    const account = await ChartOfAccount.findOne({ _id: id, business });
    if (!account) {
      return res.status(404).json({ error: "Chart account not found" });
    }

    const payload = normalizeChartAccountPayload(req.body);

    if (!payload.code || !payload.name || !payload.type) {
      return res.status(400).json({
        error: "code, name and type are required",
      });
    }

    if (account.isSystem && PROTECTED_CODES.has(account.code)) {
      if (payload.code !== account.code || payload.type !== account.type) {
        return res.status(400).json({
          error: `Core account ${account.code} cannot change code or type.`,
        });
      }
    }

    const duplicate = await ChartOfAccount.findOne({
      business,
      code: payload.code,
      _id: { $ne: account._id },
    }).lean();

    if (duplicate) {
      return res.status(409).json({
        error: "Another account already uses that code",
      });
    }

    let parent = null;
    let level = 0;

    if (payload.parentAccount) {
      if (!isValidObjectId(payload.parentAccount)) {
        return res.status(400).json({ error: "parentAccount must be a valid account id" });
      }

      if (String(payload.parentAccount) === String(account._id)) {
        return res.status(400).json({ error: "An account cannot be its own parent" });
      }

      parent = await ChartOfAccount.findOne({
        _id: payload.parentAccount,
        business,
      });

      if (!parent) {
        return res.status(404).json({ error: "Parent account not found" });
      }

      level = Number(parent.level || 0) + 1;
    }

    account.code = payload.code;
    account.name = payload.name;
    account.type = payload.type;
    account.group = payload.group;
    account.subGroup = payload.subGroup;
    account.parentAccount = parent?._id || null;
    account.level = level;
    account.isHeader = payload.isHeader;
    account.isPosting = payload.isHeader ? false : payload.isPosting;

    await account.save();

    const populated = await ChartOfAccount.findById(account._id).populate("parentAccount", "code name");
    return res.status(200).json(populated);
  } catch (err) {
    console.error("Failed to update ChartOfAccount:", err);
    return res.status(500).json({
      error: err?.message || "Failed to update ChartOfAccount",
    });
  }
});

router.delete("/:id", verifyUser, async (req, res) => {
  try {
    const business = resolveBusiness(req);
    const { id } = req.params;

    if (!business) {
      return res.status(400).json({ error: "business is required" });
    }

    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid chart account id" });
    }

    const account = await ChartOfAccount.findOne({ _id: id, business });
    if (!account) {
      return res.status(404).json({ error: "Chart account not found" });
    }

    if (PROTECTED_CODES.has(account.code)) {
      return res.status(400).json({
        error: `Core account ${account.code} cannot be deleted.`,
      });
    }

    const childCount = await ChartOfAccount.countDocuments({
      business,
      parentAccount: account._id,
    });

    if (childCount > 0) {
      return res.status(400).json({
        error: "This account has sub-accounts. Move or delete the children first.",
      });
    }

    const [ledgerUsage, invoiceUsage] = await Promise.all([
      FinancialLedgerEntry.countDocuments({ accountId: account._id }),
      TenantInvoice.countDocuments({ chartAccount: account._id }),
    ]);

    if (ledgerUsage > 0 || invoiceUsage > 0) {
      return res.status(400).json({
        error: "This account is already used in transactions and cannot be deleted.",
      });
    }

    await account.deleteOne();

    return res.status(200).json({
      success: true,
      message: "Chart account deleted successfully",
    });
  } catch (err) {
    console.error("Failed to delete ChartOfAccount:", err);
    return res.status(500).json({
      error: err?.message || "Failed to delete ChartOfAccount",
    });
  }
});

export default router;