import LandlordStatement from "../../models/LandlordStatement.js";
import { createError } from "../../utils/error.js";

/**
 * Record payment to landlord for a processed statement
 * POST /api/landlord-payments/pay
 */
export const payLandlord = async (req, res, next) => {
  try {
    const { statementId, paymentDate, amount, paymentMethod, referenceNumber, notes } = req.body;
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
    statement.paidBy = req.user._id || req.user.id;

    await statement.save();

    // TODO: Create payment voucher and post to ledger
    // This would involve:
    // 1. Creating a payment voucher record
    // 2. Posting double-entry to ledger:
    //    DR: Landlord Payable Account (decrease liability)
    //    CR: Bank/Cash Account (decrease asset)

    res.status(200).json({
      success: true,
      message: "Payment recorded successfully",
      data: {
        statement,
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

    // TODO: Post commission to ledger
    // This would involve posting double-entry to ledger:
    // DR: Landlord Payable Account (decrease the liability we owe to landlord)
    // CR: Commission Income Account (increase revenue)

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
