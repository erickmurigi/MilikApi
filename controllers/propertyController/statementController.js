import LandlordStatement from "../../models/LandlordStatement.js";
import LandlordStatementLine from "../../models/LandlordStatementLine.js";
import Property from "../../models/Property.js";
import {
  createDraftStatement,
  refreshDraftStatement,
  approveStatement,
  getStatementById,
  createRevision,
  validateStatementAudit,
} from "../../services/statementSnapshotService.js";
import { generateStatementPdf } from "../../services/statementPdfService.js";
import { emitToCompany } from "../../utils/socketManager.js";

const getUserId = (req) => req.user?._id || req.user?.id || null;
const isSystemAdmin = (req) => Boolean(req.user?.isSystemAdmin || req.user?.superAdminAccess);

const resolveBusinessId = async (req, fallbackPropertyId = null) => {
  if (req.user?.company) return req.user.company;
  if (req.body?.businessId) return req.body.businessId;
  if (req.query?.businessId) return req.query.businessId;

  const propertyId = fallbackPropertyId || req.body?.propertyId || req.query?.propertyId || null;
  if (!propertyId) return null;

  const property = await Property.findById(propertyId).select("business").lean();
  return property?.business || null;
};

const resolveLandlordIdFromProperty = async (propertyId) => {
  if (!propertyId) return null;
  const property = await Property.findById(propertyId).select("landlords").lean();
  if (!property?.landlords?.length) return null;
  const primary = property.landlords.find((l) => l?.isPrimary && l?.landlordId);
  return primary?.landlordId || property.landlords.find((l) => l?.landlordId)?.landlordId || null;
};

const buildStatementScope = (req, businessId) => {
  if (isSystemAdmin(req)) {
    return businessId ? { business: businessId } : {};
  }
  return { business: businessId };
};

const findStatementForAccess = async (req, statementId, businessId = null) => {
  const scope = buildStatementScope(req, businessId);
  return LandlordStatement.findOne({ _id: statementId, ...scope });
};

/**
 * Create a draft statement from ledger data.
 * If a draft already exists for this period, refreshes and returns it.
 */
export const createDraft = async (req, res, next) => {
  try {
    const { propertyId, periodStart, periodEnd, notes } = req.body;
    let { landlordId } = req.body;
    const userId = getUserId(req);
    const businessId = await resolveBusinessId(req, propertyId);

    if (!landlordId) {
      landlordId = await resolveLandlordIdFromProperty(propertyId);
    }

    if (!propertyId || !landlordId || !periodStart || !periodEnd) {
      return res.status(400).json({
        success: false,
        message: "propertyId, landlordId, periodStart, and periodEnd are required",
      });
    }

    if (!businessId || !userId) {
      return res.status(400).json({
        success: false,
        message: "Unable to resolve business or user context for statement creation",
      });
    }

    const existingDraft = await LandlordStatement.findOne({
      business: businessId,
      property: propertyId,
      landlord: landlordId,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      status: "draft",
    });

    if (existingDraft) {
      const refreshed = await refreshDraftStatement(existingDraft._id, userId, notes || "");
      const lines = await LandlordStatementLine.find({ statement: existingDraft._id })
        .sort({ lineNumber: 1 })
        .lean();

      return res.status(200).json({
        success: true,
        message: "Existing draft refreshed from latest ledger entries",
        data: {
          statement: refreshed.statement,
          lines,
          lineCount: lines.length,
          isExisting: true,
          refreshed: true,
        },
      });
    }

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

    return res.status(201).json({
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

export const approve = async (req, res, next) => {
  try {
    const { statementId } = req.params;
    const { approvalNotes } = req.body;
    const userId = getUserId(req);
    const businessId = await resolveBusinessId(req);

    if (!statementId) {
      return res.status(400).json({ success: false, message: "statementId is required" });
    }

    const statement = await findStatementForAccess(req, statementId, businessId);
    if (!statement) {
      return res.status(404).json({ success: false, message: "Statement not found or access denied" });
    }

    if (statement.status === "approved" || statement.status === "sent") {
      return res.status(400).json({ success: false, message: "Statement is already approved or sent" });
    }

    if (statement.status === "revised") {
      return res.status(400).json({
        success: false,
        message: "Revised statements cannot be approved. Use the superseding statement instead.",
      });
    }

    const lineCount = await LandlordStatementLine.countDocuments({
      statement: statementId,
      ...(statement.business ? { business: statement.business } : {}),
    });

    if (lineCount === 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot approve statement with no line items. Statement must contain at least one entry.",
      });
    }

    const existingApproved = await LandlordStatement.findOne({
      business: statement.business,
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

    const result = await approveStatement(statementId, userId, approvalNotes || "");

    emitToCompany(String(statement.business), "statement:approved", {
      statementId: result.statement._id,
      landlordId: result.statement.landlord,
      propertyId: result.statement.property,
    });

    return res.status(200).json({
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

export const getStatement = async (req, res, next) => {
  try {
    const { statementId } = req.params;
    const { includeLines = "true", populateRefs = "true" } = req.query;
    const businessId = await resolveBusinessId(req);

    if (!statementId) {
      return res.status(400).json({ success: false, message: "statementId is required" });
    }

    const statementCheck = await findStatementForAccess(req, statementId, businessId);
    if (!statementCheck) {
      return res.status(404).json({ success: false, message: "Statement not found or access denied" });
    }

    const result = await getStatementById(statementId, {
      includeLines: includeLines === "true",
      populateRefs: populateRefs === "true",
    });

    return res.status(200).json({
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

export const listStatementsForLandlord = async (req, res, next) => {
  try {
    const { propertyId, landlordId, periodStart, periodEnd, status, page = 1, limit = 20 } = req.query;
    const businessId = await resolveBusinessId(req, propertyId);

    if (!landlordId) {
      return res.status(400).json({ success: false, message: "landlordId is required" });
    }

    const filter = {
      ...buildStatementScope(req, businessId),
      landlord: landlordId,
    };

    if (propertyId) filter.property = propertyId;
    if (status) filter.status = status;
    if (periodStart || periodEnd) {
      filter.periodStart = {};
      if (periodStart) filter.periodStart.$gte = new Date(periodStart);
      if (periodEnd) filter.periodStart.$lte = new Date(periodEnd);
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const statements = await LandlordStatement.find(filter)
      .sort({ periodStart: -1, version: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10))
      .populate("property", "name propertyName address city")
      .populate("landlord", "firstName lastName email phone landlordName")
      .populate("approvedBy", "surname otherNames email")
      .lean();

    const total = await LandlordStatement.countDocuments(filter);

    return res.status(200).json({
      success: true,
      data: {
        statements,
        pagination: {
          total,
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          totalPages: Math.ceil(total / parseInt(limit, 10)),
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

export const createStatementRevision = async (req, res, next) => {
  try {
    const { statementId } = req.params;
    const { revisionReason } = req.body;
    const userId = getUserId(req);
    const businessId = await resolveBusinessId(req);

    if (!statementId || !revisionReason) {
      return res.status(400).json({ success: false, message: "statementId and revisionReason are required" });
    }

    const statementCheck = await findStatementForAccess(req, statementId, businessId);
    if (!statementCheck) {
      return res.status(404).json({ success: false, message: "Statement not found or access denied" });
    }

    const result = await createRevision(statementId, userId, revisionReason);

    emitToCompany(String(result.statement.business || businessId), "statement:revised", {
      originalStatementId: result.originalStatement._id,
      newStatementId: result.statement._id,
      landlordId: result.statement.landlord,
      propertyId: result.statement.property,
    });

    return res.status(201).json({
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

export const markAsSent = async (req, res, next) => {
  try {
    const { statementId } = req.params;
    const userId = getUserId(req);
    const businessId = await resolveBusinessId(req);

    if (!statementId) {
      return res.status(400).json({ success: false, message: "statementId is required" });
    }

    const statement = await findStatementForAccess(req, statementId, businessId);
    if (!statement) {
      return res.status(404).json({ success: false, message: "Statement not found or access denied" });
    }

    if (statement.status !== "approved") {
      return res.status(400).json({ success: false, message: "Only approved statements can be marked as sent" });
    }

    statement.status = "sent";
    statement.sentAt = new Date();
    statement.sentBy = userId;
    await statement.save();

    emitToCompany(String(statement.business), "statement:sent", {
      statementId: statement._id,
      landlordId: statement.landlord,
      propertyId: statement.property,
    });

    return res.status(200).json({ success: true, message: "Statement marked as sent", data: { statement } });
  } catch (err) {
    next(err);
  }
};

export const deleteDraft = async (req, res, next) => {
  try {
    const { statementId } = req.params;
    const businessId = await resolveBusinessId(req);

    if (!statementId) {
      return res.status(400).json({ success: false, message: "statementId is required" });
    }

    const statement = await findStatementForAccess(req, statementId, businessId);
    if (!statement) {
      return res.status(404).json({ success: false, message: "Statement not found or access denied" });
    }

    if (statement.status !== "draft") {
      return res.status(400).json({ success: false, message: "Only draft statements can be deleted" });
    }

    const referencedAsSupersedes = await LandlordStatement.findOne({
      business: statement.business,
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
      business: statement.business,
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

    await LandlordStatementLine.deleteMany({ statement: statementId, ...(statement.business ? { business: statement.business } : {}) });
    await LandlordStatement.findOneAndDelete({ _id: statementId, ...(statement.business ? { business: statement.business } : {}) });

    emitToCompany(String(statement.business), "statement:deleted", {
      statementId,
      landlordId: statement.landlord,
      propertyId: statement.property,
    });

    return res.status(200).json({ success: true, message: "Draft statement deleted successfully" });
  } catch (err) {
    next(err);
  }
};

export const validateAudit = async (req, res, next) => {
  try {
    const { statementId } = req.params;
    const businessId = await resolveBusinessId(req);

    if (!statementId) {
      return res.status(400).json({ success: false, message: "statementId is required" });
    }

    const statement = await findStatementForAccess(req, statementId, businessId);
    if (!statement) {
      return res.status(404).json({ success: false, message: "Statement not found or access denied" });
    }

    const validation = await validateStatementAudit(statementId);
    return res.status(200).json({ success: true, data: validation });
  } catch (err) {
    next(err);
  }
};

export const generatePdf = async (req, res, next) => {
  try {
    const { statementId } = req.params;
    const businessId = await resolveBusinessId(req);

    if (!statementId) {
      return res.status(400).json({ success: false, message: "statementId is required" });
    }

    const statement = await findStatementForAccess(req, statementId, businessId);
    if (!statement) {
      return res.status(404).json({ success: false, message: "Statement not found or access denied" });
    }

    const pdfBuffer = await generateStatementPdf(statementId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=${statement.statementNumber}.pdf`);
    return res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
};

export const getStatementSummary = async (req, res, next) => {
  try {
    const { landlordId, propertyId, year } = req.query;
    const businessId = await resolveBusinessId(req, propertyId);

    if (!landlordId) {
      return res.status(400).json({ success: false, message: "landlordId is required" });
    }

    const filter = {
      ...buildStatementScope(req, businessId),
      landlord: landlordId,
    };

    if (propertyId) filter.property = propertyId;
    if (year) {
      const start = new Date(Number(year), 0, 1);
      const end = new Date(Number(year), 11, 31, 23, 59, 59, 999);
      filter.periodStart = { $gte: start, $lte: end };
    }

    const statements = await LandlordStatement.find(filter).lean();
    const summary = {
      totalStatements: statements.length,
      draftCount: statements.filter((s) => s.status === "draft").length,
      approvedCount: statements.filter((s) => s.status === "approved").length,
      sentCount: statements.filter((s) => s.status === "sent").length,
      totalNet: statements.reduce((sum, s) => sum + (Number(s.periodNet) || 0), 0),
      totalClosingBalance: statements.reduce((sum, s) => sum + (Number(s.closingBalance) || 0), 0),
    };

    return res.status(200).json({ success: true, data: summary });
  } catch (err) {
    next(err);
  }
};
