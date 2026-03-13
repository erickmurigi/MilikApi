import mongoose from "mongoose";
import Tenant from "../../models/Tenant.js";
import Unit from "../../models/Unit.js";
import Property from "../../models/Property.js";
import RentPayment from "../../models/RentPayment.js";

const resolveBusinessId = (req) => {
  return (
    (req.user?.isSystemAdmin && (req.body?.business || req.query?.business)) ||
    req.user?.company ||
    null
  );
};

// Create tenant
export const createTenant = async (req, res, next) => {
  try {
    const leaseType = String(req.body.leaseType || "at_will").toLowerCase();

    if (!["at_will", "fixed"].includes(leaseType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid lease type. Use at_will or fixed",
      });
    }

    if (leaseType === "fixed") {
      if (!req.body.moveOutDate) {
        return res.status(400).json({
          success: false,
          message: "Move-out date is required for fixed leases",
        });
      }

      const moveInDate = new Date(req.body.moveInDate);
      const moveOutDate = new Date(req.body.moveOutDate);

      if (
        Number.isNaN(moveInDate.getTime()) ||
        Number.isNaN(moveOutDate.getTime()) ||
        moveOutDate <= moveInDate
      ) {
        return res.status(400).json({
          success: false,
          message: "Move-out date must be after move-in date for fixed leases",
        });
      }
    }

    const businessId = resolveBusinessId(req);

    if (!businessId) {
      return res.status(400).json({
        success: false,
        message:
          "Business context is required to create a tenant. Please ensure you are logged in with a company account.",
      });
    }

    if (!req.body.unit || !mongoose.Types.ObjectId.isValid(req.body.unit)) {
      return res.status(400).json({
        success: false,
        message: "A valid unit is required",
      });
    }

    const unit = await Unit.findOne({
      _id: req.body.unit,
      business: businessId,
    });

    if (!unit) {
      return res.status(404).json({
        success: false,
        message: "Unit not found for the selected company",
      });
    }

    const normalizedStatus = String(unit.status || "").trim().toLowerCase();
    const normalizedIsVacant = unit.isVacant !== false;

    if (normalizedStatus !== "vacant" || !normalizedIsVacant) {
      return res.status(400).json({
        success: false,
        message: "Unit is not available",
      });
    }

    const existingActiveTenant = await Tenant.findOne({
      unit: unit._id,
      business: businessId,
      status: { $in: ["active", "overdue"] },
    });

    if (existingActiveTenant) {
      return res.status(400).json({
        success: false,
        message: "This unit already has an active tenant",
      });
    }

    let tenantCode = req.body.tenantCode?.trim();
    if (!tenantCode) {
      const existingTenants = await Tenant.find({
        business: businessId,
        tenantCode: { $regex: /^TT\d+$/ },
      })
        .select("tenantCode")
        .lean();

      if (existingTenants.length > 0) {
        const numbers = existingTenants
          .map((t) => parseInt(String(t.tenantCode || "").replace("TT", ""), 10))
          .filter((n) => !Number.isNaN(n));

        const maxNumber = numbers.length ? Math.max(...numbers) : 0;
        tenantCode = `TT${String(maxNumber + 1).padStart(4, "0")}`;
      } else {
        tenantCode = "TT0001";
      }
    }

    const newTenant = new Tenant({
      ...req.body,
      leaseType,
      moveOutDate: leaseType === "fixed" ? req.body.moveOutDate : null,
      tenantCode,
      business: businessId,
      unit: unit._id,
      rent: Number(req.body.rent || 0),
    });

    const savedTenant = await newTenant.save();

    const property = await Property.findById(unit.property);
    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found for this unit",
      });
    }

    await Unit.findByIdAndUpdate(unit._id, {
      status: "occupied",
      isVacant: false,
      vacantSince: null,
      daysVacant: 0,
      lastTenant: savedTenant._id,
    });

    await Property.findByIdAndUpdate(property._id, {
      $inc: {
        occupiedUnits: 1,
        vacantUnits: -1,
      },
    });

    return res.status(201).json({
      success: true,
      data: savedTenant,
      message: "Tenant created successfully",
    });
  } catch (err) {
    console.error("Create tenant error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to create tenant",
    });
  }
};

// Get all tenants
export const getTenants = async (req, res, next) => {
  try {
    const { status, unit } = req.query;
    const businessId = resolveBusinessId(req);

    if (!businessId) {
      return res.status(400).json({
        success: false,
        message: "Business context is required to fetch tenants",
      });
    }

    const filter = { business: businessId };
    if (status) filter.status = status;
    if (unit) filter.unit = unit;

    const tenants = await Tenant.find(filter)
      .populate("unit", "unitNumber property rent status utilities")
      .populate("unit.property", "propertyName propertyCode address name propertyType")
      .sort({ createdAt: -1 });

    return res.status(200).json(tenants);
  } catch (err) {
    next(err);
  }
};

// Get single tenant
export const getTenant = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.id)
      .populate("unit", "unitNumber property rent amenities status utilities")
      .populate("unit.property", "propertyName propertyCode address name propertyType");

    if (!tenant) {
      return res.status(404).json({ success: false, message: "Tenant not found" });
    }

    if (
      !req.user?.isSystemAdmin &&
      tenant.business &&
      tenant.business.toString() !== req.user.company?.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to access this tenant",
      });
    }

    return res.status(200).json(tenant);
  } catch (err) {
    next(err);
  }
};

// Update tenant
export const updateTenant = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.id);

    if (!tenant) {
      return res.status(404).json({ success: false, message: "Tenant not found" });
    }

    if (
      !req.user?.isSystemAdmin &&
      tenant.business &&
      tenant.business.toString() !== req.user.company?.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this tenant",
      });
    }

    const updatedTenant = await Tenant.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true }
    ).populate("unit", "unitNumber property");

    return res.status(200).json(updatedTenant);
  } catch (err) {
    next(err);
  }
};

// Delete tenant
export const deleteTenant = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.id);

    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }

    const paymentCount = await RentPayment.countDocuments({ tenant: req.params.id });

    if (paymentCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete tenant with ${paymentCount} existing transaction(s). Please archive the tenant instead.`,
      });
    }

    if (tenant.unit) {
      const unit = await Unit.findById(tenant.unit);
      if (unit) {
        const property = await Property.findById(unit.property);

        if (property) {
          await Property.findByIdAndUpdate(property._id, {
            $inc: {
              occupiedUnits: -1,
              vacantUnits: 1,
            },
          });
        }

        await Unit.findByIdAndUpdate(tenant.unit, {
          status: "vacant",
          isVacant: true,
          vacantSince: new Date(),
          lastTenant: tenant._id,
          tenant: null,
        });
      }
    }

    await Tenant.findByIdAndDelete(req.params.id);
    return res.status(200).json({ message: "Tenant deleted successfully" });
  } catch (err) {
    next(err);
  }
};

// Update tenant status
export const updateTenantStatus = async (req, res, next) => {
  try {
    const { status, moveOutDate } = req.body;
    const tenant = await Tenant.findById(req.params.id);

    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }

    const updateData = { status };

    if (status === "moved_out" && moveOutDate) {
      updateData.moveOutDate = moveOutDate;

      if (tenant.unit) {
        const unit = await Unit.findById(tenant.unit);
        if (unit) {
          const property = await Property.findById(unit.property);

          if (property) {
            await Property.findByIdAndUpdate(property._id, {
              $inc: {
                occupiedUnits: -1,
                vacantUnits: 1,
              },
            });
          }

          await Unit.findByIdAndUpdate(tenant.unit, {
            status: "vacant",
            isVacant: true,
            vacantSince: moveOutDate,
            lastTenant: tenant._id,
            tenant: null,
          });
        }
      }
    } else if (status === "active" && tenant.status === "moved_out") {
      if (tenant.unit) {
        const unit = await Unit.findById(tenant.unit);
        if (unit && String(unit.status).toLowerCase() === "vacant") {
          const property = await Property.findById(unit.property);

          if (property) {
            await Property.findByIdAndUpdate(property._id, {
              $inc: {
                occupiedUnits: 1,
                vacantUnits: -1,
              },
            });
          }

          await Unit.findByIdAndUpdate(tenant.unit, {
            status: "occupied",
            isVacant: false,
            vacantSince: null,
            tenant: tenant._id,
          });
        }
      }
    }

    const updatedTenant = await Tenant.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true }
    );

    return res.status(200).json(updatedTenant);
  } catch (err) {
    next(err);
  }
};

// Get tenant payments
export const getTenantPayments = async (req, res, next) => {
  try {
    const payments = await RentPayment.find({ tenant: req.params.id }).sort({
      paymentDate: -1,
    });
    res.status(200).json(payments);
  } catch (err) {
    next(err);
  }
};

// Get tenant balance
export const getTenantBalance = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });

    const payments = await RentPayment.find({
      tenant: req.params.id,
      paymentType: "rent",
      isConfirmed: true,
    });

    const totalPaid = payments.reduce((sum, payment) => sum + payment.amount, 0);

    res.status(200).json({
      tenant: tenant.name,
      currentBalance: tenant.balance,
      totalPaid,
      unit: tenant.unit,
    });
  } catch (err) {
    next(err);
  }
};

// Get tenant total due
export const getTenantTotalDue = async (tenantId) => {
  try {
    const tenant = await Tenant.findById(tenantId).populate("unit");
    if (!tenant || !tenant.unit) return { rent: 0, utilities: [], total: 0 };

    const unit = await Unit.findById(tenant.unit).populate(
      "utilities.utility",
      "name unitCost billingCycle"
    );

    let total = unit.rent || 0;
    const utilitiesBreakdown = [];

    unit.utilities.forEach((item) => {
      if (item.isIncluded && item.utility) {
        const utility = item.utility;
        let charge = 0;

        if (utility.billingCycle === "monthly") {
          charge = item.unitCharge || utility.unitCost || 0;
        } else if (utility.billingCycle === "quarterly") {
          charge = (item.unitCharge || utility.unitCost || 0) / 3;
        } else if (utility.billingCycle === "annually") {
          charge = (item.unitCharge || utility.unitCost || 0) / 12;
        }

        if (charge > 0) {
          total += charge;
          utilitiesBreakdown.push({
            utility: utility._id,
            name: utility.name,
            amount: charge,
            billingCycle: utility.billingCycle,
          });
        }
      }
    });

    return {
      rent: unit.rent || 0,
      utilities: utilitiesBreakdown,
      total: parseFloat(total.toFixed(2)),
      tenantBalance: tenant.balance || 0,
    };
  } catch (error) {
    console.error("Error calculating tenant total due:", error);
    return { rent: 0, utilities: [], total: 0, tenantBalance: 0 };
  }
};

// Helper function to update property unit counts
export const updatePropertyUnitCounts = async (propertyId) => {
  try {
    const occupiedCount = await Unit.countDocuments({
      property: propertyId,
      status: "occupied",
    });

    const vacantCount = await Unit.countDocuments({
      property: propertyId,
      status: "vacant",
    });

    const totalCount = await Unit.countDocuments({ property: propertyId });

    await Property.findByIdAndUpdate(propertyId, {
      totalUnits: totalCount,
      occupiedUnits: occupiedCount,
      vacantUnits: vacantCount,
    });

    return { totalCount, occupiedCount, vacantCount };
  } catch (error) {
    console.error("Error updating property unit counts:", error);
    throw error;
  }
};

// Bulk import tenants from Excel
export const bulkImportTenants = async (req, res, next) => {
  try {
    const { tenants: tenantsData, business } = req.body;

    if (!business) {
      return res.status(400).json({ message: "Business context is required" });
    }

    if (!Array.isArray(tenantsData) || tenantsData.length === 0) {
      return res.status(400).json({ message: "No tenant data provided" });
    }

    if (tenantsData.length > 1000) {
      return res.status(400).json({ message: "Maximum 1000 tenants per import" });
    }

    const units = await Unit.find({ business }).populate("property");

    const unitMap = new Map();
    units.forEach((unit) => {
      const propertyCode = unit.property?.propertyCode?.toLowerCase();
      const unitNumber = unit.unitNumber?.toLowerCase();
      if (propertyCode && unitNumber) {
        unitMap.set(`${propertyCode}|${unitNumber}`, unit._id);
      }
    });

    const existingTenants = await Tenant.find({ business });
    const existingPhones = new Set(existingTenants.map((t) => t.phone?.toLowerCase()));
    const existingIds = new Set(existingTenants.map((t) => t.idNumber?.toLowerCase()));

    const successful = [];
    const failed = [];

    for (const record of tenantsData) {
      const rowIndex = tenantsData.indexOf(record) + 1;

      try {
        if (!record.propertyCode) {
          failed.push({
            tenantName: record.tenantName,
            error: "Property Code is required",
            row: rowIndex,
          });
          continue;
        }

        const unitLookupKey = `${record.propertyCode.toLowerCase()}|${record.unitNumber.toLowerCase()}`;
        const unitId = unitMap.get(unitLookupKey);

        if (!unitId) {
          failed.push({
            tenantName: record.tenantName,
            error: `Combination not found: Property "${record.propertyCode}" + Unit "${record.unitNumber}"`,
            row: rowIndex,
          });
          continue;
        }

        if (existingPhones.has(record.phoneNumber.toLowerCase())) {
          failed.push({
            tenantName: record.tenantName,
            error: `Duplicate phone number: ${record.phoneNumber}`,
            row: rowIndex,
          });
          continue;
        }

        if (existingIds.has(record.idNumber.toLowerCase())) {
          failed.push({
            tenantName: record.tenantName,
            error: `Duplicate ID number: ${record.idNumber}`,
            row: rowIndex,
          });
          continue;
        }

        const leaseType = String(record.leaseType || "at_will").toLowerCase();
        if (!["at_will", "fixed"].includes(leaseType)) {
          failed.push({
            tenantName: record.tenantName,
            error: `Invalid lease type: ${record.leaseType}. Must be at_will or fixed`,
            row: rowIndex,
          });
          continue;
        }

        const moveInDate = record.moveInDate ? new Date(record.moveInDate) : null;
        const moveOutDate = record.moveOutDate ? new Date(record.moveOutDate) : null;

        if (!moveInDate || Number.isNaN(moveInDate.getTime())) {
          failed.push({
            tenantName: record.tenantName,
            error: `Invalid move-in date for tenant ${record.tenantName}`,
            row: rowIndex,
          });
          continue;
        }

        if (leaseType === "fixed") {
          if (!moveOutDate || Number.isNaN(moveOutDate.getTime())) {
            failed.push({
              tenantName: record.tenantName,
              error: "Move-out date is required for fixed lease type",
              row: rowIndex,
            });
            continue;
          }

          if (moveOutDate <= moveInDate) {
            failed.push({
              tenantName: record.tenantName,
              error: "Move-out date must be after move-in date for fixed lease type",
              row: rowIndex,
            });
            continue;
          }
        }

        let tenantCode = record.tenantCode;
        if (!tenantCode || tenantCode.trim() === "") {
          const existingCodes = await Tenant.find({
            business,
            tenantCode: { $regex: /^TT\d+$/ },
          })
            .select("tenantCode")
            .lean();

          if (existingCodes.length > 0) {
            const numbers = existingCodes
              .map((t) => parseInt(String(t.tenantCode).replace("TT", ""), 10))
              .filter((n) => !Number.isNaN(n));

            const maxNumber = numbers.length ? Math.max(...numbers) : 0;
            tenantCode = `TT${String(maxNumber + 1).padStart(4, "0")}`;
          } else {
            tenantCode = "TT0001";
          }
        }

        const newTenant = new Tenant({
          name: record.tenantName,
          phone: record.phoneNumber,
          idNumber: record.idNumber,
          unit: unitId,
          rent: record.rent || 0,
          balance: 0,
          status: record.status || "active",
          paymentMethod: record.paymentMethod || "bank_transfer",
          leaseType,
          moveInDate,
          moveOutDate: leaseType === "fixed" ? moveOutDate : null,
          tenantCode,
          business,
          emergencyContact: {
            name: record.emergencyContactName || "",
            phone: record.emergencyContactPhone || "",
            relationship: "",
          },
          description: record.description || "",
        });

        await newTenant.save();

        const unitToUpdate = units.find((u) => u._id.toString() === unitId.toString());
        if (unitToUpdate) {
          await Unit.findByIdAndUpdate(unitId, {
            status: "occupied",
            isVacant: false,
            vacantSince: null,
            daysVacant: 0,
            lastTenant: newTenant._id,
          });

          const propertyId = unitToUpdate.property._id || unitToUpdate.property;
          await Property.findByIdAndUpdate(propertyId, {
            $inc: {
              occupiedUnits: 1,
              vacantUnits: -1,
            },
          });
        }

        existingPhones.add(record.phoneNumber.toLowerCase());
        existingIds.add(record.idNumber.toLowerCase());

        successful.push({
          tenantName: record.tenantName,
          _id: newTenant._id,
          tenantCode,
        });
      } catch (error) {
        failed.push({
          tenantName: record.tenantName,
          error: error.message || "Unknown error occurred",
          row: rowIndex,
        });
      }
    }

    return res.status(200).json({
      successful,
      failed,
      totalProcessed: tenantsData.length,
      successCount: successful.length,
      failureCount: failed.length,
    });
  } catch (error) {
    console.error("Bulk import error:", error);
    return res.status(500).json({
      message: error.message || "Failed to process bulk import",
    });
  }
};

// Migration endpoint: Assign tenant codes to existing tenants without codes
export const migrateTenantCodes = async (req, res, next) => {
  try {
    const business = resolveBusinessId(req);

    const tenantsWithoutCodes = await Tenant.find({
      business,
      $or: [
        { tenantCode: { $exists: false } },
        { tenantCode: null },
        { tenantCode: "" },
      ],
    }).sort({ createdAt: 1 });

    if (tenantsWithoutCodes.length === 0) {
      return res.status(200).json({
        message: "No tenants found without codes",
        updated: 0,
      });
    }

    let updatedCount = 0;
    const updates = [];

    for (let i = 0; i < tenantsWithoutCodes.length; i += 1) {
      const tenant = tenantsWithoutCodes[i];
      const tenantCode = `TT${String(i + 1).padStart(4, "0")}`;

      try {
        await Tenant.findByIdAndUpdate(tenant._id, { tenantCode });
        updatedCount += 1;
        updates.push({
          tenantId: tenant._id,
          tenantName: tenant.name,
          assignedCode: tenantCode,
        });
      } catch (err) {
        console.error(`Failed to update tenant ${tenant._id}:`, err);
      }
    }

    return res.status(200).json({
      message: `Successfully assigned codes to ${updatedCount} tenants`,
      updated: updatedCount,
      details: updates,
    });
  } catch (err) {
    next(err);
  }
};