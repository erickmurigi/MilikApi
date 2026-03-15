import LandlordStatement from "../../models/LandlordStatement.js";
import { createError } from "../../utils/error.js";

/**
 * Record payment to landlord for a processed statement
 * POST /api/landlord-payments/pay
 */
export const payLandlord = async (req, res, next) => {
  try {
    const { statementId, paymentDate, amount, paymentMethod, cashbook, referenceNumber, notes } = req.body;
    const businessId = req.user.company;

    if (!statementId) {
      return next(createError(400, "statementId is required"));
    }

    if (!amount || amount <= 0) {
      return next(createError(400, "Valid payment amount is required"));
    }

    // Find statement with business isolation
    const statement = await LandlordStatement.findOne({
      _id: statementId,
      business: businessId,
    });

    if (!statement) {
      return next(createError(404, "Statement not found or access denied"));
    }

    // Update statement with payment details
    statement.status = "paid";
    statement.amountPaid = amount;
    statement.paidDate = paymentDate ? new Date(paymentDate) : new Date();
    statement.paymentMethod = paymentMethod || "Bank Transfer";
    statement.paymentReference = referenceNumber || "";
    statement.paymentNotes = notes || "";
    statement.metadata = { ...(statement.metadata || {}), paymentCashbook: cashbook || "" };
    statement.paidBy = req.user._id || req.user.id;

    await statement.save();

    // 1. Create payment voucher
    const PaymentVoucher = (await import("../../models/PaymentVoucher.js")).default;
    const generateVoucherNo = async (businessId) => {
      const prefix = "PV";
      const lastVoucher = await PaymentVoucher.findOne(
        { business: businessId, voucherNo: { $regex: `^${prefix}\\d+$` } },
        { voucherNo: 1 },
        { sort: { createdAt: -1 } }
      );
      let seq = 1;
      if (lastVoucher?.voucherNo) {
        seq = (parseInt(lastVoucher.voucherNo.replace(prefix, ""), 10) || 0) + 1;
      }
      return `${prefix}${String(seq).padStart(5, "0")}`;
    };

    const voucherNo = await generateVoucherNo(statement.business);
    const voucher = await PaymentVoucher.create({
      voucherNo,
      category: "landlord_other",
      status: "approved",
      property: statement.property,
      landlord: statement.landlord,
      amount: statement.amountPaid,
      dueDate: new Date(),
      paidDate: new Date(),
      reference: statement._id,
      narration: `Landlord payment for statement ${statement._id}${cashbook ? ` from ${cashbook}` : ""}`,
      approvedBy: req.user._id || req.user.id,
      approvedAt: new Date(),
      paidBy: req.user._id || req.user.id,
      paidAt: new Date(),
      business: statement.business,
    });

    // 2. Post double-entry to ledger
    const { postEntry } = await import("../../services/ledgerPostingService.js");
    // DR: Landlord Payable Account (decrease liability)
    await postEntry({
      business: statement.business,
      property: statement.property,
      landlord: statement.landlord,
      sourceTransactionType: "payment_voucher",
      sourceTransactionId: voucher._id,
      transactionDate: new Date(),
      statementPeriodStart: statement.periodStart,
      statementPeriodEnd: statement.periodEnd,
      category: "EXPENSE_DEDUCTION",
      amount: statement.amountPaid,
      direction: "debit",
      payer: "manager",
      receiver: "landlord",
      notes: `Landlord payment voucher ${voucherNo}${cashbook ? ` via ${cashbook}` : ""}`,
      createdBy: req.user._id || req.user.id,
      approvedBy: req.user._id || req.user.id,
      approvedAt: new Date(),
      status: "approved",
    });
    // CR: Bank/Cash Account (decrease asset)
    await postEntry({
      business: statement.business,
      property: statement.property,
      landlord: statement.landlord,
      sourceTransactionType: "payment_voucher",
      sourceTransactionId: voucher._id,
      transactionDate: new Date(),
      statementPeriodStart: statement.periodStart,
      statementPeriodEnd: statement.periodEnd,
      category: "EXPENSE_DEDUCTION",
      amount: statement.amountPaid,
      direction: "credit",
      payer: "manager",
      receiver: "bank",
      notes: `Landlord payment voucher ${voucherNo}${cashbook ? ` via ${cashbook}` : ""}`,
      createdBy: req.user._id || req.user.id,
      approvedBy: req.user._id || req.user.id,
      approvedAt: new Date(),
      status: "approved",
    });

    res.status(200).json({
      success: true,
      message: "Payment recorded successfully",
      data: {
        statement,
        voucher,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Post commission income for a processed statement
 * POST /api/landlord-payments/post-commission
 */
export const postCommission = async (req, res, next) => {
  try {
    const { statementId, postingDate, amount, notes } = req.body;
    const businessId = req.user.company;

    if (!statementId) {
      return next(createError(400, "statementId is required"));
    }

    if (!amount || amount <= 0) {
      return next(createError(400, "Valid commission amount is required"));
    }

    // Find statement with business isolation
    const statement = await LandlordStatement.findOne({
      _id: statementId,
      business: businessId,
    });

    if (!statement) {
      return next(createError(404, "Statement not found or access denied"));
    }

    // Update statement with commission posting details
    statement.commissionPosted = true;
    statement.commissionPostedDate = postingDate ? new Date(postingDate) : new Date();
    statement.commissionPostedAmount = amount;
    statement.commissionNotes = notes || "";
    statement.commissionPostedBy = req.user._id || req.user.id;

    await statement.save();

    // Post commission to ledger
    const { postEntry } = await import("../../services/ledgerPostingService.js");
    // DR: Landlord Payable Account (decrease liability)
    await postEntry({
      business: statement.business,
      property: statement.property,
      landlord: statement.landlord,
      sourceTransactionType: "commission_posting",
      sourceTransactionId: statement._id,
      transactionDate: postingDate ? new Date(postingDate) : new Date(),
      statementPeriodStart: statement.periodStart,
      statementPeriodEnd: statement.periodEnd,
      category: "COMMISSION_CHARGE",
      amount: amount,
      direction: "debit",
      payer: "manager",
      receiver: "landlord",
      notes: `Commission posting for statement ${statement._id}`,
      createdBy: req.user._id || req.user.id,
      approvedBy: req.user._id || req.user.id,
      approvedAt: new Date(),
      status: "approved",
    });
    // CR: Commission Income Account (increase revenue)
    await postEntry({
      business: statement.business,
      property: statement.property,
      landlord: statement.landlord,
      sourceTransactionType: "commission_posting",
      sourceTransactionId: statement._id,
      transactionDate: postingDate ? new Date(postingDate) : new Date(),
      statementPeriodStart: statement.periodStart,
      statementPeriodEnd: statement.periodEnd,
      category: "COMMISSION_CHARGE",
      amount: amount,
      direction: "credit",
      payer: "manager",
      receiver: "system",
      notes: `Commission posting for statement ${statement._id}`,
      createdBy: req.user._id || req.user.id,
      approvedBy: req.user._id || req.user.id,
      approvedAt: new Date(),
      status: "approved",
    });

    res.status(200).json({
      success: true,
      message: "Commission posted successfully",
      data: {
        statement,
      },
    });
  } catch (err) {
    next(err);
  }
};

export default {
  payLandlord,
  postCommission,
};
