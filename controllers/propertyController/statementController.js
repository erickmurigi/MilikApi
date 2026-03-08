import LandlordStatement from "../../models/LandlordStatement.js";
import LandlordStatementLine from "../../models/LandlordStatementLine.js";
import {
  createDraftStatement,
  approveStatement,
  getStatementById,
  createRevision,
  validateStatementAudit,
} from "../../services/statementSnapshotService.js";
import { generateStatementPdf } from "../../services/statementPdfService.js";
import { emitToCompany } from "../../utils/socketManager.js";

/**
 * Create a draft statement from ledger data.
 * If a draft already exists for the same period/landlord, returns the existing draft.
 */
export const createDraft = async (req, res, next) => {
  try {
    const { propertyId, landlordId, periodStart, periodEnd, notes } = req.body;
    const businessId = req.user.company;
    const userId = req.user?._id || req.user?.id;

    if (!propertyId || !landlordId || !periodStart || !periodEnd) {
      return res.status(400).json({
        success: false,
        message: "propertyId, landlordId, periodStart, and periodEnd are required",
      });
    }

    // Check if draft already exists for this period
    const existingDraft = await LandlordStatement.findOne({
      business: businessId,
      property: propertyId,
      landlord: landlordId,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      status: "draft",
    });

    if (existingDraft) {
      // Return existing draft with lines
      const lines = await LandlordStatementLine.find({ statement: existingDraft._id })
        .sort({ lineNumber: 1 })
        .lean();

      return res.status(200).json({
        success: true,
        message: "Draft statement already exists for this period",
        data: {
          statement: existingDraft,
          lines,
          lineCount: lines.length,
          isExisting: true,
        },
      });
    }

    // Create new draft
    const result = await createDraftStatement({
      businessId,
      propertyId,
      landlordId,
      statementPeriodStart: periodStart,
      statementPeriodEnd: periodEnd,
      userId,
      notes: notes || "",
    });

    emitToCompany(businessId, "statement:created", {
      statementId: result.statement._id,
      landlordId,
      propertyId,
    });

    res.status(201).json({
      success: true,
      message: "Draft statement created successfully",
      data: {
        statement: result.statement,
        lineCount: result.lineCount,
        isExisting: false,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Approve a draft statement, freezing it as immutable.
 */
export const approve = async (req, res, next) => {
  try {
    const { statementId } = req.params;
    const { approvalNotes } = req.body;
    const userId = req.user?._id || req.user?.id;
    const businessId = req.user.company;

    if (!statementId) {
      return res.status(400).json({
        success: false,
        message: "statementId is required",
      });
    }

    // Enforce business isolation
    const statement = await LandlordStatement.findOne({
      _id: statementId,
      business: businessId,
    });

    if (!statement) {
      return res.status(404).json({
        success: false,
        message: "Statement not found or access denied",
      });
    }

    if (statement.status === "approved" || statement.status === "sent") {
      return res.status(400).json({
        success: false,
        message: "Statement is already approved or sent",
      });
    }

    if (statement.status === "revised") {
      return res.status(400).json({
        success: false,
        message: "Revised statements cannot be approved. Use the superseding statement instead.",
      });
    }

    // Safeguard: Prevent approval of empty statements
    const lineCount = await LandlordStatementLine.countDocuments({
      statement: statementId,
      business: businessId,
    });

    if (lineCount === 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot approve statement with no line items. Statement must contain at least one entry.",
      });
    }

    // Safeguard: Prevent multiple approved statements for the same period
    const existingApproved = await LandlordStatement.findOne({
      business: businessId,
      property: statement.property,
      landlord: statement.landlord,
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
      status: "approved",
      _id: { $ne: statementId },
    });

    if (existingApproved) {
      return res.status(400).json({
        success: false,
        message: `An approved statement already exists for this period (${existingApproved.statementNumber}). Please create a revision instead.`,
        data: {
          existingStatementId: existingApproved._id,
          existingStatementNumber: existingApproved.statementNumber,
        },
      });
    }

    // Approve statement (freezes statement and lines)
    const result = await approveStatement(statementId, userId, approvalNotes || "");

    emitToCompany(businessId, "statement:approved", {
      statementId: result.statement._id,
      landlordId: result.statement.landlord,
      propertyId: result.statement.property,
    });

    res.status(200).json({
      success: true,
      message: "Statement approved and frozen successfully",
      data: {
        statement: result.statement,
        lines: result.lines,
        lineCount: result.lines.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get a single statement by ID with its lines.
 * Always uses frozen snapshot data, never regenerates from ledger.
 */
export const getStatement = async (req, res, next) => {
  try {
    const { statementId } = req.params;
    const { includeLines = "true", populateRefs = "false" } = req.query;
    const businessId = req.user.company;

    if (!statementId) {
      return res.status(400).json({
        success: false,
        message: "statementId is required",
      });
    }

    // Enforce business isolation
    const statementCheck = await LandlordStatement.findOne({
      _id: statementId,
      business: businessId,
    });

    if (!statementCheck) {
      return res.status(404).json({
        success: false,
        message: "Statement not found or access denied",
      });
    }

    const result = await getStatementById(statementId, {
      includeLines: includeLines === "true",
      populateRefs: populateRefs === "true",
    });

    res.status(200).json({
      success: true,
      data: {
        statement: result.statement,
        lines: result.lines,
        lineCount: result.lines.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * List statements for a landlord with filtering.
 * Returns snapshot headers only (lines fetched separately via getStatement).
 */
export const listStatementsForLandlord = async (req, res, next) => {
  try {
    const {
      propertyId,
      landlordId,
      periodStart,
      periodEnd,
      status,
      page = 1,
      limit = 20,
    } = req.query;

    const businessId = req.user.company;

    if (!landlordId) {
      return res.status(400).json({
        success: false,
        message: "landlordId is required",
      });
    }

    const filter = {
      business: businessId,
      landlord: landlordId,
    };

    if (propertyId) filter.property = propertyId;
    if (status) filter.status = status;

    if (periodStart || periodEnd) {
      filter.periodStart = {};
      if (periodStart) filter.periodStart.$gte = new Date(periodStart);
      if (periodEnd) filter.periodStart.$lte = new Date(periodEnd);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const statements = await LandlordStatement.find(filter)
      .sort({ periodStart: -1, version: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate("property", "name address")
      .populate("landlord", "firstName lastName email phone")
      .populate("approvedBy", "surname otherNames email")
      .lean();

    const total = await LandlordStatement.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: {
        statements,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Create a revision of an approved/sent statement.
 * Marks original as "revised" and creates new draft version.
 */
export const createStatementRevision = async (req, res, next) => {
  try {
    const { statementId } = req.params;
    const { revisionReason } = req.body;
    const userId = req.user?._id || req.user?.id;
    const businessId = req.user.company;

    if (!statementId || !revisionReason) {
      return res.status(400).json({
        success: false,
        message: "statementId and revisionReason are required",
      });
    }

    // Enforce business isolation
    const statementCheck = await LandlordStatement.findOne({
      _id: statementId,
      business: businessId,
    });

    if (!statementCheck) {
      return res.status(404).json({
        success: false,
        message: "Statement not found or access denied",
      });
    }

    const result = await createRevision(statementId, userId, revisionReason);

    emitToCompany(businessId, "statement:revised", {
      originalStatementId: result.originalStatement._id,
      newStatementId: result.statement._id,
      landlordId: result.statement.landlord,
      propertyId: result.statement.property,
    });

    res.status(201).json({
      success: true,
      message: "Statement revision created successfully",
      data: {
        newStatement: result.statement,
        originalStatement: result.originalStatement,
        lineCount: result.lineCount,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Mark an approved statement as sent (for tracking purposes).
 */
export const markAsSent = async (req, res, next) => {
  try {
    const { statementId } = req.params;
    const userId = req.user?._id || req.user?.id;
    const businessId = req.user.company;

    if (!statementId) {
      return res.status(400).json({
        success: false,
        message: "statementId is required",
      });
    }

    // Enforce business isolation
    const statement = await LandlordStatement.findOne({
      _id: statementId,
      business: businessId,
    });

    if (!statement) {
      return res.status(404).json({
        success: false,
        message: "Statement not found or access denied",
      });
    }

    if (statement.status !== "approved") {
      return res.status(400).json({
        success: false,
        message: "Only approved statements can be marked as sent",
      });
    }

    statement.status = "sent";
    statement.sentAt = new Date();
    statement.sentBy = userId;
    await statement.save();

    emitToCompany(businessId, "statement:sent", {
      statementId: statement._id,
      landlordId: statement.landlord,
      propertyId: statement.property,
    });

    res.status(200).json({
      success: true,
      message: "Statement marked as sent",
      data: { statement },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Delete a draft statement (only drafts can be deleted).
 */
export const deleteDraft = async (req, res, next) => {
  try {
    const { statementId } = req.params;
    const businessId = req.user.company;

    if (!statementId) {
      return res.status(400).json({
        success: false,
        message: "statementId is required",
      });
    }

    // Enforce business isolation
    const statement = await LandlordStatement.findOne({
      _id: statementId,
      business: businessId,
    });

    if (!statement) {
      return res.status(404).json({
        success: false,
        message: "Statement not found or access denied",
      });
    }

    if (statement.status !== "draft") {
      return res.status(400).json({
        success: false,
        message: "Only draft statements can be deleted",
      });
    }

    // Safeguard: Protect draft deletion in revision chains
    // Check if this statement is referenced in any revision chain
    const referencedAsSupersedes = await LandlordStatement.findOne({
      business: businessId,
      supersededByStatementId: statementId,
    });

    if (referencedAsSupersedes) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete statement. It is referenced as a superseding version by statement ${referencedAsSupersedes.statementNumber}`,
        data: {
          referencedByStatementId: referencedAsSupersedes._id,
          referencedByStatementNumber: referencedAsSupersedes.statementNumber,
        },
      });
    }

    const referencedAsOriginal = await LandlordStatement.findOne({
      business: businessId,
      supersedesStatementId: statementId,
    });

    if (referencedAsOriginal) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete statement. It is referenced as an original version by revision ${referencedAsOriginal.statementNumber}`,
        data: {
          referencedByStatementId: referencedAsOriginal._id,
          referencedByStatementNumber: referencedAsOriginal.statementNumber,
        },
      });
    }

    // Delete associated lines first
    await LandlordStatementLine.deleteMany({
      statement: statementId,
      business: businessId,
    });

    // Delete statement header
    await LandlordStatement.findOneAndDelete({
      _id: statementId,
      business: businessId,
    });

    emitToCompany(businessId, "statement:deleted", {
      statementId,
      landlordId: statement.landlord,
      propertyId: statement.property,
    });

    res.status(200).json({
      success: true,
      message: "Draft statement deleted successfully",
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Validate statement audit integrity.
 * Checks that header counts match actual frozen lines.
 */
export const validateAudit = async (req, res, next) => {
  try {
    const { statementId } = req.params;
    const businessId = req.user.company;

    if (!statementId) {
      return res.status(400).json({
        success: false,
        message: "statementId is required",
      });
    }

    // Enforce business isolation
    const statementCheck = await LandlordStatement.findOne({
      _id: statementId,
      business: businessId,
    });

    if (!statementCheck) {
      return res.status(404).json({
        success: false,
        message: "Statement not found or access denied",
      });
    }

    const result = await validateStatementAudit(statementId);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Generate and download PDF for an approved/sent statement.
 * Uses immutable statement snapshot only - never regenerates from ledger.
 */
export const generatePdf = async (req, res, next) => {
  try {
    const { statementId } = req.params;
    const businessId = req.user.company;

    if (!statementId) {
      return res.status(400).json({
        success: false,
        message: "statementId is required",
      });
    }

    // Enforce business isolation
    const statement = await LandlordStatement.findOne({
      _id: statementId,
      business: businessId,
    }).lean();

    if (!statement) {
      return res.status(404).json({
        success: false,
        message: "Statement not found or access denied",
      });
    }

    // Generate PDF from immutable snapshot
    const pdfBuffer = await generateStatementPdf(statementId, businessId);

    // Set response headers for PDF download
    const filename = `Statement_${statement.statementNumber}_${statement.landlord}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);

    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
};

/**
 * Get statement summary statistics for a property/landlord.
 */
export const getStatementSummary = async (req, res, next) => {
  try {
    const { propertyId, landlordId, year } = req.query;
    const businessId = req.user.company;

    if (!landlordId) {
      return res.status(400).json({
        success: false,
        message: "landlordId is required",
      });
    }

    const filter = {
      business: businessId,
      landlord: landlordId,
    };

    if (propertyId) filter.property = propertyId;
    if (year) {
      const yearInt = parseInt(year);
      filter.periodStart = {
        $gte: new Date(yearInt, 0, 1),
        $lt: new Date(yearInt + 1, 0, 1),
      };
    }

    const statements = await LandlordStatement.find(filter).lean();

    const summary = {
      total: statements.length,
      byStatus: {
        draft: statements.filter((s) => s.status === "draft").length,
        reviewed: statements.filter((s) => s.status === "reviewed").length,
        approved: statements.filter((s) => s.status === "approved").length,
        sent: statements.filter((s) => s.status === "sent").length,
        revised: statements.filter((s) => s.status === "revised").length,
      },
      totalOpeningBalance: statements.reduce((sum, s) => sum + (s.openingBalance || 0), 0),
      totalPeriodNet: statements.reduce((sum, s) => sum + (s.periodNet || 0), 0),
      totalClosingBalance: statements.reduce((sum, s) => sum + (s.closingBalance || 0), 0),
      latestStatement: statements.sort((a, b) => 
        new Date(b.periodStart).getTime() - new Date(a.periodStart).getTime()
      )[0] || null,
    };

    res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (err) {
    next(err);
  }
};

export default {
  createDraft,
  approve,
  getStatement,
  listStatementsForLandlord,
  createStatementRevision,
  markAsSent,
  deleteDraft,
  validateAudit,
  generatePdf,
  getStatementSummary,
};
