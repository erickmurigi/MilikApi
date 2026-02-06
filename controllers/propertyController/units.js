

// controllers/unitController.js - Updated
import Unit from "../../models/Unit.js";
import Tenant from "../../models/Tenant.js";
import Property from "../../models/Property.js";
import Utility from "../../models/Utility.js";

// Calculate total monthly amount including utilities
export const calculateTotalMonthlyAmount = async (unitId) => {
  try {
    const unit = await Unit.findById(unitId)
      .populate('utilities.utility', 'name unitCost billingCycle');
    
    if (!unit) return { rent: 0, utilities: [], total: 0 };
    
    let total = unit.rent || 0;
    const utilitiesBreakdown = [];
    
    // Calculate included utilities
    unit.utilities.forEach(item => {
      if (item.isIncluded) {
        const utility = item.utility;
        let charge = 0;
        
        // Calculate charge based on billing cycle
        if (utility.billingCycle === 'monthly') {
          charge = item.unitCharge || utility.unitCost || 0;
        } else if (utility.billingCycle === 'quarterly') {
          charge = (item.unitCharge || utility.unitCost || 0) / 3;
        } else if (utility.billingCycle === 'annually') {
          charge = (item.unitCharge || utility.unitCost || 0) / 12;
        } else if (utility.billingCycle === 'per_use') {
          // For per_use, charge is added when actually used
          charge = 0;
        }
        
        if (charge > 0) {
          total += charge;
          utilitiesBreakdown.push({
            utility: utility._id,
            name: utility.name,
            amount: charge,
            billingCycle: utility.billingCycle,
            isIncluded: true
          });
        }
      }
    });
    
    return {
      rent: unit.rent || 0,
      utilities: utilitiesBreakdown,
      total: parseFloat(total.toFixed(2))
    };
  } catch (error) {
    console.error('Error calculating total monthly amount:', error);
    return { rent: 0, utilities: [], total: 0 };
  }
};

// Create unit
export const createUnit = async(req, res, next) => {
    try {
        const newUnit = new Unit({
            ...req.body, 
            business: req.body.business
        });
        
        const savedUnit = await newUnit.save();
        
        // Update property unit counts
        await updatePropertyUnitCounts(savedUnit.property);
        
        // Calculate total monthly amount
        const totalAmount = await calculateTotalMonthlyAmount(savedUnit._id);
        
        const response = {
            ...savedUnit._doc,
            totalMonthlyAmount: totalAmount
        };
        
        res.status(200).json(response);
    } catch (err) {
        next(err);
    }
}

// Get all units with utility calculations
export const getUnits = async(req, res, next) => {
    const { business, property, status } = req.query;
    try {
        const filter = { business };
        if (property) filter.property = property;
        if (status) filter.status = status;
        
        const units = await Unit.find(filter)
            .populate('property', 'name address')
            .populate('utilities.utility', 'name unitCost billingCycle isActive')
            .sort({ property: 1, unitNumber: 1 });
        
        // Calculate total amount for each unit
        const unitsWithTotal = await Promise.all(
            units.map(async (unit) => {
                const totalAmount = await calculateTotalMonthlyAmount(unit._id);
                return {
                    ...unit._doc,
                    totalMonthlyAmount: totalAmount
                };
            })
        );
        
        res.status(200).json(unitsWithTotal);
    } catch (err) {
        next(err);
    }
}

// Get single unit with detailed utility calculations
export const getUnit = async(req, res, next) => {
    try {
        const unit = await Unit.findById(req.params.id)
            .populate('property', 'name address landlord')
            .populate('utilities.utility', 'name unitCost billingCycle description isActive')
            .populate('lastTenant', 'name phone');
        
        if (!unit) return res.status(404).json({ message: "Unit not found" });
        
        // Calculate total monthly amount
        const totalAmount = await calculateTotalMonthlyAmount(unit._id);
        
        const response = {
            ...unit._doc,
            totalMonthlyAmount: totalAmount
        };
        
        res.status(200).json(response);
    } catch (err) {
        next(err);
    }
}

// Get unit utilities breakdown
export const getUnitUtilities = async(req, res, next) => {
    try {
        const unit = await Unit.findById(req.params.id)
            .populate('utilities.utility', 'name unitCost billingCycle description');
        
        if (!unit) return res.status(404).json({ message: "Unit not found" });
        
        const utilitiesBreakdown = await calculateTotalMonthlyAmount(req.params.id);
        
        res.status(200).json(utilitiesBreakdown);
    } catch (err) {
        next(err);
    }
}

// Add utility to unit
export const addUtilityToUnit = async(req, res, next) => {
    try {
        const { utility, isIncluded, unitCharge } = req.body;
        
        const unit = await Unit.findById(req.params.id);
        if (!unit) return res.status(404).json({ message: "Unit not found" });
        
        // Check if utility already exists
        const existingUtilityIndex = unit.utilities.findIndex(
            u => u.utility.toString() === utility
        );
        
        if (existingUtilityIndex !== -1) {
            // Update existing utility
            unit.utilities[existingUtilityIndex] = {
                utility,
                isIncluded,
                unitCharge: unitCharge || 0
            };
        } else {
            // Add new utility
            unit.utilities.push({
                utility,
                isIncluded,
                unitCharge: unitCharge || 0
            });
        }
        
        const updatedUnit = await unit.save();
        const totalAmount = await calculateTotalMonthlyAmount(unit._id);
        
        res.status(200).json({
            ...updatedUnit._doc,
            totalMonthlyAmount: totalAmount
        });
    } catch (err) {
        next(err);
    }
}

// Remove utility from unit
export const removeUtilityFromUnit = async(req, res, next) => {
    try {
        const { utilityId } = req.params;
        
        const unit = await Unit.findById(req.params.unitId);
        if (!unit) return res.status(404).json({ message: "Unit not found" });
        
        // Filter out the utility
        unit.utilities = unit.utilities.filter(
            u => u.utility.toString() !== utilityId
        );
        
        const updatedUnit = await unit.save();
        const totalAmount = await calculateTotalMonthlyAmount(unit._id);
        
        res.status(200).json({
            ...updatedUnit._doc,
            totalMonthlyAmount: totalAmount
        });
    } catch (err) {
        next(err);
    }
}


// Delete unit
export const deleteUnit = async(req, res, next) => {
    try {
        // Check if unit has tenants
        const tenants = await Tenant.find({ unit: req.params.id });
        if (tenants.length > 0) {
            return res.status(400).json({ 
                message: "Cannot delete unit with existing tenants" 
            });
        }
        
        const unit = await Unit.findById(req.params.id);
        await Unit.findByIdAndDelete(req.params.id);
        
        // Update property unit counts
        if (unit) {
            await updatePropertyUnitCounts(unit.property);
        }
        
        res.status(200).json({ message: "Unit deleted successfully" });
    } catch (err) {
        next(err);
    }
}

// Update unit status
export const updateUnitStatus = async(req, res, next) => {
    try {
        const { status } = req.body;
        const updateData = { status };
        
        if (status === 'vacant') {
            updateData.vacantSince = new Date();
            updateData.isVacant = true;
            updateData.lastTenant = req.body.lastTenant || null;
        } else {
            updateData.vacantSince = null;
            updateData.isVacant = false;
            updateData.daysVacant = 0;
        }
        
        const updatedUnit = await Unit.findByIdAndUpdate(
            req.params.id,
            { $set: updateData },
            { new: true }
        );
        
        // Update vacancy days if needed
        if (status === 'vacant') {
            await updateVacancyDays(updatedUnit);
        }
        
        // Update property unit counts
        await updatePropertyUnitCounts(updatedUnit.property);
        
        res.status(200).json(updatedUnit);
    } catch (err) {
        next(err);
    }
}

// Get available units
export const getAvailableUnits = async(req, res, next) => {
    const { business, property } = req.query;
    try {
        const filter = { 
            business, 
            status: 'vacant',
            isVacant: true 
        };
        if (property) filter.property = property;
        
        const units = await Unit.find(filter)
            .populate('property', 'name address')
            .sort({ rent: 1 });
        res.status(200).json(units);
    } catch (err) {
        next(err);
    }
}

// Helper function to update property unit counts
const updatePropertyUnitCounts = async(propertyId) => {
    const totalUnits = await Unit.countDocuments({ property: propertyId });
    const occupiedUnits = await Unit.countDocuments({ 
        property: propertyId, 
        status: 'occupied' 
    });
    const vacantUnits = totalUnits - occupiedUnits;
    
    // Calculate total rent
    const units = await Unit.find({ property: propertyId, status: 'occupied' });
    const totalRent = units.reduce((sum, unit) => sum + unit.rent, 0);
    
    await Property.findByIdAndUpdate(propertyId, {
        totalUnits,
        occupiedUnits,
        vacantUnits,
        totalRent
    });
}

// Helper function to update vacancy days
const updateVacancyDays = async(unit) => {
    if (unit.vacantSince) {
        const today = new Date();
        const vacantDate = new Date(unit.vacantSince);
        const daysVacant = Math.floor((today - vacantDate) / (1000 * 60 * 60 * 24));
        
        await Unit.findByIdAndUpdate(unit._id, {
            daysVacant
        });
    }
}

// Update unit
export const updateUnit = async(req, res, next) => {
    try {
        const updatedUnit = await Unit.findByIdAndUpdate(
            req.params.id,
            { $set: req.body },
            { new: true }
        ).populate('property', 'name address');
        res.status(200).json(updatedUnit);
    } catch (err) {
        next(err);
    }
}