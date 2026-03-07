// controllers/propertyController/processedStatements.js
import ProcessedStatement from "../../models/ProcessedStatement.js";
import Landlord from "../../models/Landlord.js";
import Property from "../../models/Property.js";

// @desc    Create/close a new processed statement
// @route   POST /api/processed-statements
// @access  Private
export const closeStatement = async (req, res) => {
  try {
    const {
      business,
      landlord,
      property,
      periodStart,
      periodEnd,
      totalRentInvoiced,
      totalRentReceived,
      commissionPercentage,
      commissionBasis,
      commissionAmount,
      netAmountDue,
      occupiedUnits,
      vacantUnits,
      tenantRows,
      notes,
    } = req.body;
    const userId = req.user.id;

    // Validation
    if (!business || !landlord || !property || !periodStart || !periodEnd) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Check if statement already closed for this period
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
      business,
      landlord,
      property,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      totalRentInvoiced: Number(totalRentInvoiced) || 0,
      totalRentReceived: Number(totalRentReceived) || 0,
      commissionPercentage: Number(commissionPercentage) || 0,
      commissionBasis: commissionBasis || "received",
      commissionAmount: Number(commissionAmount) || 0,
      netAmountDue: Number(netAmountDue) || 0,
      occupiedUnits: Number(occupiedUnits) || 0,
      vacantUnits: Number(vacantUnits) || 0,
      tenantRows: tenantRows || [],
      status: "unpaid",
      closedBy: userId,
      closedAt: new Date(),
      notes: notes || null,
    });

    const savedStatement = await newStatement.save();

    // Populate references for response
    await savedStatement.populate([
      { path: "landlord", select: "landlordName email contact" },
      { path: "property", select: "propertyCode propertyName" },
      { path: "business", select: "companyName" },
      { path: "closedBy", select: "username email" },
    ]);

    res.status(201).json({
      success: true,
      message: "Statement closed successfully",
      statement: savedStatement,
    });
  } catch (error) {
    console.error("Close statement error:", error);
    res.status(500).json({ message: "Error closing statement", error: error.message });
  }
};

// @desc    Get all processed statements for a business
// @route   GET /api/processed-statements/:businessId
// @access  Private
export const getStatementsByBusiness = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { status, landlord, month } = req.query;

    let query = { business: businessId };

    if (status && ["paid", "unpaid"].includes(status)) {
      query.status = status;
    }

    if (landlord) {
      query.landlord = landlord;
    }

    // Filter by month if provided (format: YYYY-MM)
    if (month) {
      const [year, monthNum] = month.split("-");
      const startDate = new Date(year, parseInt(monthNum) - 1, 1);
      const endDate = new Date(year, parseInt(monthNum), 0, 23, 59, 59, 999);
      query.periodStart = { $gte: startDate };
      query.periodEnd = { $lte: endDate };
    }

    const statements = await ProcessedStatement.find(query)
      .populate([
        { path: "landlord", select: "landlordName" },
        { path: "property", select: "propertyCode propertyName" },
        { path: "business", select: "companyName" },
      ])
      .sort({ closedAt: -1 });

    res.status(200).json({
      success: true,
      count: statements.length,
      statements,
    });
  } catch (error) {
    console.error("Get statements error:", error);
    res.status(500).json({ message: "Error fetching statements", error: error.message });
  }
};

// @desc    Get single processed statement
// @route   GET /api/processed-statements/detail/:statementId
// @access  Private
export const getStatementById = async (req, res) => {
  try {
    const { statementId } = req.params;

    const statement = await ProcessedStatement.findById(statementId)
      .populate([
        { path: "landlord" },
        { path: "property" },
        { path: "business", select: "companyName address phone email" },
        { path: "closedBy", select: "username email" },
      ]);

    if (!statement) {
      return res.status(404).json({ message: "Statement not found" });
    }

    res.status(200).json({
      success: true,
      statement,
    });
  } catch (error) {
    console.error("Get statement error:", error);
    res.status(500).json({ message: "Error fetching statement", error: error.message });
  }
};

// @desc    Update processed statement (mark as paid, add notes, etc.)
// @route   PUT /api/processed-statements/:statementId
// @access  Private
export const updateStatement = async (req, res) => {
  try {
    const { statementId } = req.params;
    const { status, amountPaid, paidDate, paymentMethod, paymentReference, notes } = req.body;

    const statement = await ProcessedStatement.findById(statementId);

    if (!statement) {
      return res.status(404).json({ message: "Statement not found" });
    }

    // Update fields if provided
    if (status && ["paid", "unpaid"].includes(status)) {
      statement.status = status;
    }

    if (amountPaid !== undefined) {
      statement.amountPaid = Number(amountPaid);
    }

    if (paidDate) {
      statement.paidDate = new Date(paidDate);
    }

    if (paymentMethod) {
      statement.paymentMethod = paymentMethod;
    }

    if (paymentReference) {
      statement.paymentReference = paymentReference;
    }

    if (notes !== undefined) {
      statement.notes = notes;
    }

    const updatedStatement = await statement.save();

    await updatedStatement.populate([
      { path: "landlord", select: "landlordName" },
      { path: "property", select: "propertyCode propertyName" },
      { path: "business", select: "companyName" },
    ]);

    res.status(200).json({
      success: true,
      message: "Statement updated successfully",
      statement: updatedStatement,
    });
  } catch (error) {
    console.error("Update statement error:", error);
    res.status(500).json({ message: "Error updating statement", error: error.message });
  }
};

// @desc    Delete processed statement
// @route   DELETE /api/processed-statements/:statementId
// @access  Private
export const deleteStatement = async (req, res) => {
  try {
    const { statementId } = req.params;

    const result = await ProcessedStatement.findByIdAndDelete(statementId);

    if (!result) {
      return res.status(404).json({ message: "Statement not found" });
    }

    res.status(200).json({
      success: true,
      message: "Statement deleted successfully",
    });
  } catch (error) {
    console.error("Delete statement error:", error);
    res.status(500).json({ message: "Error deleting statement", error: error.message });
  }
};

// @desc    Get statements summary (stats)
// @route   GET /api/processed-statements-stats/:businessId
// @access  Private
export const getStatementStats = async (req, res) => {
  try {
    const { businessId } = req.params;

    const stats = await ProcessedStatement.aggregate([
      {
        $match: { business: mongoose.Types.ObjectId(businessId) },
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$netAmountDue" },
          totalPaid: { $sum: "$amountPaid" },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error("Get stats error:", error);
    res.status(500).json({ message: "Error fetching stats", error: error.message });
  }
};
