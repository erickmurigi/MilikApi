// controllers/propertyController/processedStatements.js
import mongoose from "mongoose";
import ProcessedStatement from "../../models/ProcessedStatement.js";
import User from "../../models/User.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const resolveActorUserId = async (req, businessId) => {
  const direct = req.user?._id || req.user?.id;
  if (isValidObjectId(direct)) return String(direct);
  if (businessId && isValidObjectId(businessId)) {
    const companyUser = await User.findOne({ company: businessId, isActive: { $ne: false } })
      .sort({ createdAt: 1 })
      .select("_id")
      .lean();
    if (companyUser?._id) return String(companyUser._id);
  }
  return null;
};

export const closeStatement = async (req, res) => {
  try {
    const payload = req.body || {};
    const business = payload.business || req.user?.company || null;
    const landlord = payload.landlord;
    const property = payload.property;
    const periodStart = payload.periodStart;
    const periodEnd = payload.periodEnd;
    const userId = await resolveActorUserId(req, business);

    if (!business || !landlord || !property || !periodStart || !periodEnd || !userId) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const existingStatement = await ProcessedStatement.findOne({
      business,
      landlord,
      property,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
    });

    if (existingStatement) {
      return res.status(400).json({ message: "Statement already closed for this period" });
    }

    const newStatement = new ProcessedStatement({
      ...payload,
      business,
      landlord,
      property,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      statementType: payload.statementType || "provisional",
      totalRentInvoiced: Number(payload.totalRentInvoiced) || 0,
      totalRentReceived: Number(payload.totalRentReceived) || 0,
      totalRentReceivedByManager: Number(payload.totalRentReceivedByManager) || 0,
      totalRentReceivedByLandlord: Number(payload.totalRentReceivedByLandlord) || 0,
      totalUtilitiesCollected: Number(payload.totalUtilitiesCollected) || 0,
      depositsHeldByManager: Number(payload.depositsHeldByManager) || 0,
      depositsHeldByLandlord: Number(payload.depositsHeldByLandlord) || 0,
      unappliedPayments: Number(payload.unappliedPayments) || 0,
      commissionPercentage: Number(payload.commissionPercentage) || 0,
      commissionBasis: payload.commissionBasis || "received",
      commissionAmount: Number(payload.commissionAmount) || 0,
      netAmountDue: Number(payload.netAmountDue) || 0,
      totalExpenses: Number(payload.totalExpenses) || 0,
      recurringDeductions: Number(payload.recurringDeductions) || 0,
      advanceRecoveries: Number(payload.advanceRecoveries) || 0,
      netAfterExpenses: Number(payload.netAfterExpenses ?? payload.netAmountDue) || 0,
      amountPayableByLandlordToManager: Number(payload.amountPayableByLandlordToManager) || 0,
      occupiedUnits: Number(payload.occupiedUnits) || 0,
      vacantUnits: Number(payload.vacantUnits) || 0,
      status: "unpaid",
      closedBy: userId,
      closedAt: new Date(),
    });

    const savedStatement = await newStatement.save();
    await savedStatement.populate([
      { path: "landlord", select: "landlordName firstName lastName email contact" },
      { path: "property", select: "propertyCode propertyName name" },
      { path: "business", select: "companyName name" },
      { path: "closedBy", select: "username email surname otherNames" },
    ]);

    res.status(201).json({ success: true, message: "Statement closed successfully", statement: savedStatement });
  } catch (error) {
    console.error("Close statement error:", error);
    res.status(500).json({ message: "Error closing statement", error: error.message });
  }
};

export const getStatementsByBusiness = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { status, landlord, month } = req.query;
    const query = { business: businessId };
    if (status && ["paid", "unpaid"].includes(status)) query.status = status;
    if (landlord) query.landlord = landlord;
    if (month) {
      const [year, monthNum] = month.split("-");
      query.periodStart = { $gte: new Date(year, Number(monthNum) - 1, 1) };
      query.periodEnd = { $lte: new Date(year, Number(monthNum), 0, 23, 59, 59, 999) };
    }
    const statements = await ProcessedStatement.find(query)
      .populate([{ path: "landlord", select: "landlordName firstName lastName" }, { path: "property", select: "propertyCode propertyName name" }, { path: "business", select: "companyName name" }])
      .sort({ closedAt: -1 });
    res.status(200).json({ success: true, count: statements.length, statements });
  } catch (error) {
    console.error("Get statements error:", error);
    res.status(500).json({ message: "Error fetching statements", error: error.message });
  }
};

export const getStatementById = async (req, res) => {
  try {
    const { statementId } = req.params;
    const statement = await ProcessedStatement.findById(statementId)
      .populate([{ path: "landlord" }, { path: "property" }, { path: "business", select: "companyName address phone email" }, { path: "closedBy", select: "username email" }]);
    if (!statement) return res.status(404).json({ message: "Statement not found" });
    res.status(200).json({ success: true, statement });
  } catch (error) {
    console.error("Get statement error:", error);
    res.status(500).json({ message: "Error fetching statement", error: error.message });
  }
};

export const updateStatement = async (req, res) => {
  try {
    const { statementId } = req.params;
    const { status, amountPaid, paidDate, paymentMethod, paymentReference, notes } = req.body;
    const statement = await ProcessedStatement.findById(statementId);
    if (!statement) return res.status(404).json({ message: "Statement not found" });
    if (status && ["paid", "unpaid"].includes(status)) statement.status = status;
    if (amountPaid !== undefined) statement.amountPaid = Number(amountPaid);
    if (paidDate) statement.paidDate = new Date(paidDate);
    if (paymentMethod) statement.paymentMethod = paymentMethod;
    if (paymentReference) statement.paymentReference = paymentReference;
    if (notes !== undefined) statement.notes = notes;
    const updatedStatement = await statement.save();
    await updatedStatement.populate([{ path: "landlord", select: "landlordName firstName lastName" }, { path: "property", select: "propertyCode propertyName name" }, { path: "business", select: "companyName name" }]);
    res.status(200).json({ success: true, message: "Statement updated successfully", statement: updatedStatement });
  } catch (error) {
    console.error("Update statement error:", error);
    res.status(500).json({ message: "Error updating statement", error: error.message });
  }
};

export const deleteStatement = async (req, res) => {
  try {
    const { statementId } = req.params;
    const result = await ProcessedStatement.findByIdAndDelete(statementId);
    if (!result) return res.status(404).json({ message: "Statement not found" });
    res.status(200).json({ success: true, message: "Statement deleted successfully" });
  } catch (error) {
    console.error("Delete statement error:", error);
    res.status(500).json({ message: "Error deleting statement", error: error.message });
  }
};

export const getStatementStats = async (req, res) => {
  try {
    const { businessId } = req.params;
    const stats = await ProcessedStatement.aggregate([
      { $match: { business: new mongoose.Types.ObjectId(businessId) } },
      { $group: { _id: "$status", count: { $sum: 1 }, totalAmount: { $sum: "$netAmountDue" }, totalPaid: { $sum: "$amountPaid" } } },
    ]);
    res.status(200).json({ success: true, stats });
  } catch (error) {
    console.error("Get stats error:", error);
    res.status(500).json({ message: "Error fetching stats", error: error.message });
  }
};
