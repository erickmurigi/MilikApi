import mongoose from "mongoose";
import Unit from "../../models/Unit.js";
import Tenant from "../../models/Tenant.js";
import Property from "../../models/Property.js";

const resolveBusinessId = (req) => {
  return (
    (req.user?.isSystemAdmin && (req.body?.business || req.query?.business)) ||
    req.user?.company ||
    null
  );
};

const normalizePropertyId = (propertyValue) => {
  if (!propertyValue) return null;
  if (typeof propertyValue === "string") return propertyValue;
  if (typeof propertyValue === "object" && propertyValue._id) {
    return String(propertyValue._id);
  }
  return String(propertyValue);
};

export const calculateTotalMonthlyAmount = async (unitId) => {
  try {
    const unit = await Unit.findById(unitId);

    if (!unit) {
      return { rent: 0, utilities: [], total: 0 };
    }

    let total = Number(unit.rent || 0);
    const utilitiesBreakdown = (unit.utilities || []).map((item) => {
      const charge = Number(item.unitCharge || 0);
      total += charge;

      return {
        utility: item.utility || "",
        utilityLabel: item.utility || "Unknown Utility",
        amount: charge,
        isIncluded: !!item.isIncluded,
      };
    });

    return {
      rent: Number(unit.rent || 0),
      utilities: utilitiesBreakdown,
      total: Number(total.toFixed(2)),
    };
  } catch (error) {
    console.error("Error calculating total monthly amount:", error);
    return { rent: 0, utilities: [], total: 0 };
  }
};

const updatePropertyUnitCounts = async (propertyId) => {
  if (!propertyId) return;

  const totalUnits = await Unit.countDocuments({ property: propertyId });
  const occupiedUnits = await Unit.countDocuments({
    property: propertyId,
    status: "occupied",
  });
  const vacantUnits = await Unit.countDocuments({
    property: propertyId,
    status: "vacant",
  });

  await Property.findByIdAndUpdate(propertyId, {
    totalUnits,
    occupiedUnits,
    vacantUnits,
  });
};

const attachCurrentTenant = async (unitDoc) => {
  if (!unitDoc) return null;

  const activeTenant = await Tenant.findOne({
    unit: unitDoc._id,
    status: "active",
  }).select("name phone status");

  const totalMonthlyAmount = await calculateTotalMonthlyAmount(unitDoc._id);

  return {
    ...unitDoc.toObject(),
    currentTenant: activeTenant || null,
    totalMonthlyAmount,
  };
};

// CREATE UNIT
export const createUnit = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);

    if (!businessId) {
      return res.status(400).json({
        success: false,
        message:
          "Business context is required to create a unit. Please ensure you are logged in with a company account.",
      });
    }

    if (!req.body.property) {
      return res.status(400).json({
        success: false,
        message: "Property is required.",
      });
    }

    const property = await Property.findById(req.body.property);
    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Selected property was not found.",
      });
    }

    const newUnit = new Unit({
      ...req.body,
      property: req.body.property,
      business: businessId,
      status: req.body.status || "vacant",
      isVacant: (req.body.status || "vacant") === "vacant",
      vacantSince: (req.body.status || "vacant") === "vacant" ? new Date() : null,
      daysVacant: 0,
    });

    const savedUnit = await newUnit.save();

    await updatePropertyUnitCounts(savedUnit.property);

    const populatedUnit = await Unit.findById(savedUnit._id)
      .populate("property", "propertyName propertyCode address")
      .populate("lastTenant", "name phone status");

    const responsePayload = await attachCurrentTenant(populatedUnit);

    return res.status(201).json(responsePayload);
  } catch (err) {
    console.error("Create unit error:", err);

    let errorMessage = err.message || "Failed to create unit";

    if (err.name === "ValidationError") {
      errorMessage = Object.values(err.errors)
        .map((e) => e.message)
        .join("; ");
    } else if (err.code === 11000) {
      errorMessage = "A unit with this number already exists for this property";
    }

    return res.status(400).json({
      success: false,
      message: errorMessage,
    });
  }
};

// GET ALL UNITS
export const getUnits = async (req, res, next) => {
  try {
    const { property, status } = req.query;
    const businessId = resolveBusinessId(req);

    if (!businessId) {
      return res.status(400).json({
        success: false,
        message: "Business context is required to fetch units",
      });
    }

    const filter = { business: businessId };
    if (property) filter.property = property;
    if (status) filter.status = status;

    const units = await Unit.find(filter)
      .populate("property", "propertyName propertyCode address")
      .populate("lastTenant", "name phone status")
      .sort({ createdAt: -1 });

    const activeTenants = await Tenant.find({
      unit: { $in: units.map((u) => u._id) },
      status: "active",
    }).select("name phone status unit");

    const tenantMap = new Map(
      activeTenants.map((tenant) => [String(tenant.unit), tenant])
    );

    const unitsWithExtras = await Promise.all(
      units.map(async (unit) => {
        const totalMonthlyAmount = await calculateTotalMonthlyAmount(unit._id);

        return {
          ...unit.toObject(),
          currentTenant: tenantMap.get(String(unit._id)) || null,
          totalMonthlyAmount,
        };
      })
    );

    return res.status(200).json(unitsWithExtras);
  } catch (err) {
    next(err);
  }
};

// GET SINGLE UNIT
export const getUnit = async (req, res, next) => {
  try {
    const unit = await Unit.findById(req.params.id)
      .populate("property", "propertyName propertyCode address")
      .populate("lastTenant", "name phone status");

    if (!unit) {
      return res.status(404).json({ message: "Unit not found" });
    }

    const payload = await attachCurrentTenant(unit);
    return res.status(200).json(payload);
  } catch (err) {
    next(err);
  }
};

// UPDATE UNIT
export const updateUnit = async (req, res, next) => {
  try {
    const unit = await Unit.findById(req.params.id);

    if (!unit) {
      return res.status(404).json({
        success: false,
        message: "Unit not found",
      });
    }

    const businessId = resolveBusinessId(req);
    if (
      !req.user?.isSystemAdmin &&
      unit.business &&
      String(unit.business) !== String(businessId)
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this unit",
      });
    }

    const previousPropertyId = normalizePropertyId(unit.property);

    Object.keys(req.body).forEach((key) => {
      if (req.body[key] !== undefined) {
        unit[key] = req.body[key];
      }
    });

    if (req.body.status) {
      unit.isVacant = req.body.status === "vacant";
      if (req.body.status === "vacant" && !unit.vacantSince) {
        unit.vacantSince = new Date();
      }
      if (req.body.status !== "vacant") {
        unit.vacantSince = null;
        unit.daysVacant = 0;
      }
    }

    const updatedUnit = await unit.save();

    const newPropertyId = normalizePropertyId(updatedUnit.property);

    if (previousPropertyId) {
      await updatePropertyUnitCounts(previousPropertyId);
    }
    if (newPropertyId && newPropertyId !== previousPropertyId) {
      await updatePropertyUnitCounts(newPropertyId);
    }

    const populatedUnit = await Unit.findById(updatedUnit._id)
      .populate("property", "propertyName propertyCode address")
      .populate("lastTenant", "name phone status");

    const payload = await attachCurrentTenant(populatedUnit);

    return res.status(200).json(payload);
  } catch (err) {
    console.error("Update unit error:", err);

    let errorMessage = err.message || "Failed to update unit";

    if (err.name === "ValidationError") {
      errorMessage = Object.values(err.errors)
        .map((e) => e.message)
        .join("; ");
    } else if (err.code === 11000) {
      errorMessage = "A unit with this number already exists for this property";
    }

    return res.status(400).json({
      success: false,
      message: errorMessage,
    });
  }
};

// DELETE UNIT
export const deleteUnit = async (req, res, next) => {
  try {
    const existingTenant = await Tenant.findOne({ unit: req.params.id });
    if (existingTenant) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete unit with existing tenant records",
      });
    }

    const unit = await Unit.findById(req.params.id);
    if (!unit) {
      return res.status(404).json({
        success: false,
        message: "Unit not found",
      });
    }

    const propertyId = normalizePropertyId(unit.property);

    await Unit.findByIdAndDelete(req.params.id);

    if (propertyId) {
      await updatePropertyUnitCounts(propertyId);
    }

    return res.status(200).json({
      success: true,
      message: "Unit deleted successfully",
    });
  } catch (err) {
    next(err);
  }
};

// UPDATE UNIT STATUS
export const updateUnitStatus = async (req, res, next) => {
  try {
    const { status } = req.body;

    const unit = await Unit.findById(req.params.id);
    if (!unit) {
      return res.status(404).json({ message: "Unit not found" });
    }

    unit.status = status;

    if (status === "vacant") {
      unit.isVacant = true;
      unit.vacantSince = new Date();
      unit.daysVacant = 0;
    } else {
      unit.isVacant = false;
      unit.vacantSince = null;
      unit.daysVacant = 0;
    }

    const updatedUnit = await unit.save();
    await updatePropertyUnitCounts(updatedUnit.property);

    return res.status(200).json(updatedUnit);
  } catch (err) {
    next(err);
  }
};

// GET AVAILABLE UNITS
export const getAvailableUnits = async (req, res, next) => {
  try {
    const { property } = req.query;
    const businessId = resolveBusinessId(req);

    if (!businessId) {
      return res.status(400).json({
        success: false,
        message: "Business context is required to fetch available units",
      });
    }

    const filter = {
      business: businessId,
      status: "vacant",
      isVacant: true,
    };

    if (property) filter.property = property;

    const units = await Unit.find(filter)
      .populate("property", "propertyName propertyCode address")
      .sort({ rent: 1 });

    return res.status(200).json(units);
  } catch (err) {
    next(err);
  }
};

// GET UNIT UTILITIES
export const getUnitUtilities = async (req, res, next) => {
  try {
    const unit = await Unit.findById(req.params.id);

    if (!unit) {
      return res.status(404).json({ message: "Unit not found" });
    }

    const totalMonthlyAmount = await calculateTotalMonthlyAmount(unit._id);

    return res.status(200).json({
      utilities: unit.utilities || [],
      totalMonthlyAmount,
    });
  } catch (err) {
    next(err);
  }
};

// ADD UTILITY TO UNIT
export const addUtilityToUnit = async (req, res, next) => {
  try {
    const { utility, isIncluded = false, unitCharge = 0 } = req.body;

    const unit = await Unit.findById(req.params.id);
    if (!unit) {
      return res.status(404).json({ message: "Unit not found" });
    }

    const existingIndex = (unit.utilities || []).findIndex(
      (u) => String(u.utility) === String(utility)
    );

    if (existingIndex >= 0) {
      unit.utilities[existingIndex] = {
        utility,
        isIncluded,
        unitCharge: Number(unitCharge || 0),
      };
    } else {
      unit.utilities.push({
        utility,
        isIncluded,
        unitCharge: Number(unitCharge || 0),
      });
    }

    const updatedUnit = await unit.save();
    return res.status(200).json(updatedUnit);
  } catch (err) {
    next(err);
  }
};

// REMOVE UTILITY FROM UNIT
export const removeUtilityFromUnit = async (req, res, next) => {
  try {
    const { unitId, utilityId } = req.params;

    const unit = await Unit.findById(unitId);
    if (!unit) {
      return res.status(404).json({ message: "Unit not found" });
    }

    unit.utilities = (unit.utilities || []).filter(
      (u) => String(u.utility) !== String(utilityId)
    );

    const updatedUnit = await unit.save();
    return res.status(200).json(updatedUnit);
  } catch (err) {
    next(err);
  }
};

// BULK IMPORT UNITS
export const bulkImportUnits = async (req, res, next) => {
  try {
    const { units: unitsData, business } = req.body;

    if (!business) {
      return res.status(400).json({
        success: false,
        message: "Business context is required",
      });
    }

    if (!Array.isArray(unitsData) || unitsData.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No units data provided",
      });
    }

    const properties = await Property.find({ business }).select("_id propertyCode");
    const propertyCodeMap = new Map(
      properties.map((p) => [String(p.propertyCode || "").toLowerCase(), String(p._id)])
    );

    const successful = [];
    const failed = [];

    for (let i = 0; i < unitsData.length; i++) {
      const row = unitsData[i];

      try {
        const propertyId = propertyCodeMap.get(
          String(row.propertyCode || "").toLowerCase()
        );

        if (!propertyId) {
          failed.push({
            row: i + 2,
            unitNumber: row.unitNumber,
            error: `Property code "${row.propertyCode}" not found`,
          });
          continue;
        }

        const newUnit = new Unit({
          unitNumber: row.unitNumber,
          property: propertyId,
          unitType: row.unitType,
          rent: Number(row.rent || 0),
          deposit: Number(row.deposit || 0),
          status: row.status || "vacant",
          isVacant: (row.status || "vacant") === "vacant",
          amenities: Array.isArray(row.amenities) ? row.amenities : [],
          utilities: Array.isArray(row.utilities) ? row.utilities : [],
          billingFrequency: row.billingFrequency || "monthly",
          description: row.description || "",
          areaSqFt: Number(row.areaSqFt || 0),
          business,
        });

        const saved = await newUnit.save();
        await updatePropertyUnitCounts(propertyId);

        successful.push({
          _id: saved._id,
          unitNumber: saved.unitNumber,
        });
      } catch (error) {
        failed.push({
          row: i + 2,
          unitNumber: row.unitNumber,
          error: error.message || "Failed to import unit",
        });
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        successful,
        failed,
        totalProcessed: unitsData.length,
        successCount: successful.length,
        failureCount: failed.length,
      },
    });
  } catch (err) {
    next(err);
  }
};