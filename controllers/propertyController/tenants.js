// controllers/tenantController.js
import Tenant from "../../models/Tenant.js";
import Unit from "../../models/Unit.js";
import Property from "../../models/Property.js";
import RentPayment from "../../models/RentPayment.js";

// Create tenant
export const createTenant = async (req, res, next) => {
    try {
        // Check if unit is available
        const unit = await Unit.findById(req.body.unit);
        if (!unit) {
            return res.status(404).json({ message: "Unit not found" });
        }
        if (unit.status !== 'vacant') {
            return res.status(400).json({ message: "Unit is not available" });
        }

        // Create new tenant
        const newTenant = new Tenant({ ...req.body, business: req.body.business });
        const savedTenant = await newTenant.save();

        // Get the property associated with this unit
        const property = await Property.findById(unit.property);
        if (!property) {
            return res.status(404).json({ message: "Property not found for this unit" });
        }

        // Update unit status
        await Unit.findByIdAndUpdate(req.body.unit, {
            status: 'occupied',
            isVacant: false,
            vacantSince: null,
            daysVacant: 0,
            tenant: savedTenant._id // Store reference to tenant
        });

        // Update property unit counts
        await Property.findByIdAndUpdate(property._id, {
            $inc: {
                occupiedUnits: 1,
                vacantUnits: -1
            }
        });

        res.status(200).json(savedTenant);
    } catch (err) {
        next(err);
    }
}

// Get all tenants
export const getTenants = async (req, res, next) => {
    const { business, status, unit } = req.query;
    try {
        const filter = { business };
        if (status) filter.status = status;
        if (unit) filter.unit = unit;

        const tenants = await Tenant.find(filter)
            .populate('unit', 'unitNumber property rent status')
            .populate('unit.property', 'name address')
            .sort({ createdAt: -1 });
        res.status(200).json(tenants);
    } catch (err) {
        next(err);
    }
}

// Get single tenant
export const getTenant = async (req, res, next) => {
    try {
        const tenant = await Tenant.findById(req.params.id)
            .populate('unit', 'unitNumber property rent amenities status')
            .populate('unit.property', 'name address propertyType');
        if (!tenant) return res.status(404).json({ message: "Tenant not found" });
        res.status(200).json(tenant);
    } catch (err) {
        next(err);
    }
}

// Update tenant
export const updateTenant = async (req, res, next) => {
    try {
        const updatedTenant = await Tenant.findByIdAndUpdate(
            req.params.id,
            { $set: req.body },
            { new: true }
        ).populate('unit', 'unitNumber property');
        res.status(200).json(updatedTenant);
    } catch (err) {
        next(err);
    }
}

// Delete tenant
export const deleteTenant = async (req, res, next) => {
    try {
        const tenant = await Tenant.findById(req.params.id);
        if (!tenant) return res.status(404).json({ message: "Tenant not found" });

        if (tenant.unit) {
            // Get the unit and its property
            const unit = await Unit.findById(tenant.unit);
            if (unit) {
                // Get the property
                const property = await Property.findById(unit.property);
                
                if (property) {
                    // Update property unit counts
                    await Property.findByIdAndUpdate(property._id, {
                        $inc: {
                            occupiedUnits: -1,
                            vacantUnits: 1
                        }
                    });
                }

                // Update unit status
                await Unit.findByIdAndUpdate(tenant.unit, {
                    status: 'vacant',
                    isVacant: true,
                    vacantSince: new Date(),
                    lastTenant: tenant._id,
                    tenant: null // Remove tenant reference
                });
            }
        }

        await Tenant.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: "Tenant deleted successfully" });
    } catch (err) {
        next(err);
    }
}

// Update tenant status
export const updateTenantStatus = async (req, res, next) => {
    try {
        const { status, moveOutDate } = req.body;
        const tenant = await Tenant.findById(req.params.id);
        
        if (!tenant) {
            return res.status(404).json({ message: "Tenant not found" });
        }

        const updateData = { status };
        
        if (status === 'moved_out' && moveOutDate) {
            updateData.moveOutDate = moveOutDate;
            
            // Update unit and property if tenant is moving out
            if (tenant.unit) {
                const unit = await Unit.findById(tenant.unit);
                if (unit) {
                    // Get the property
                    const property = await Property.findById(unit.property);
                    
                    if (property) {
                        // Update property unit counts
                        await Property.findByIdAndUpdate(property._id, {
                            $inc: {
                                occupiedUnits: -1,
                                vacantUnits: 1
                            }
                        });
                    }

                    // Update unit status
                    await Unit.findByIdAndUpdate(tenant.unit, {
                        status: 'vacant',
                        isVacant: true,
                        vacantSince: moveOutDate,
                        lastTenant: tenant._id,
                        tenant: null
                    });
                }
            }
        } else if (status === 'active' && tenant.status === 'moved_out') {
            // If moving tenant back to active (re-occupying)
            if (tenant.unit) {
                const unit = await Unit.findById(tenant.unit);
                if (unit && unit.status === 'vacant') {
                    // Get the property
                    const property = await Property.findById(unit.property);
                    
                    if (property) {
                        // Update property unit counts
                        await Property.findByIdAndUpdate(property._id, {
                            $inc: {
                                occupiedUnits: 1,
                                vacantUnits: -1
                            }
                        });
                    }

                    // Update unit status
                    await Unit.findByIdAndUpdate(tenant.unit, {
                        status: 'occupied',
                        isVacant: false,
                        vacantSince: null,
                        tenant: tenant._id
                    });
                }
            }
        }

        const updatedTenant = await Tenant.findByIdAndUpdate(
            req.params.id,
            { $set: updateData },
            { new: true }
        );
        res.status(200).json(updatedTenant);
    } catch (err) {
        next(err);
    }
}

// Get tenant payments
export const getTenantPayments = async (req, res, next) => {
    try {
        const payments = await RentPayment.find({ tenant: req.params.id })
            .sort({ paymentDate: -1 });
        res.status(200).json(payments);
    } catch (err) {
        next(err);
    }
}

// Get tenant balance
export const getTenantBalance = async (req, res, next) => {
    try {
        const tenant = await Tenant.findById(req.params.id);
        if (!tenant) return res.status(404).json({ message: "Tenant not found" });

        const payments = await RentPayment.find({
            tenant: req.params.id,
            paymentType: 'rent',
            isConfirmed: true
        });

        const totalPaid = payments.reduce((sum, payment) => sum + payment.amount, 0);

        res.status(200).json({
            tenant: tenant.name,
            currentBalance: tenant.balance,
            totalPaid,
            unit: tenant.unit
        });
    } catch (err) {
        next(err);
    }
}

// Get tenant total due
export const getTenantTotalDue = async (tenantId) => {
    try {
        const tenant = await Tenant.findById(tenantId).populate('unit');
        if (!tenant || !tenant.unit) return { rent: 0, utilities: [], total: 0 };

        const unit = await Unit.findById(tenant.unit)
            .populate('utilities.utility', 'name unitCost billingCycle');

        let total = unit.rent || 0;
        const utilitiesBreakdown = [];

        // Calculate included utilities
        unit.utilities.forEach(item => {
            if (item.isIncluded && item.utility) {
                const utility = item.utility;
                let charge = 0;

                if (utility.billingCycle === 'monthly') {
                    charge = item.unitCharge || utility.unitCost || 0;
                } else if (utility.billingCycle === 'quarterly') {
                    charge = (item.unitCharge || utility.unitCost || 0) / 3;
                } else if (utility.billingCycle === 'annually') {
                    charge = (item.unitCharge || utility.unitCost || 0) / 12;
                }

                if (charge > 0) {
                    total += charge;
                    utilitiesBreakdown.push({
                        utility: utility._id,
                        name: utility.name,
                        amount: charge,
                        billingCycle: utility.billingCycle
                    });
                }
            }
        });

        return {
            rent: unit.rent || 0,
            utilities: utilitiesBreakdown,
            total: parseFloat(total.toFixed(2)),
            tenantBalance: tenant.balance || 0
        };
    } catch (error) {
        console.error('Error calculating tenant total due:', error);
        return { rent: 0, utilities: [], total: 0, tenantBalance: 0 };
    }
};

// Helper function to update property unit counts
export const updatePropertyUnitCounts = async (propertyId) => {
    try {
        // Count occupied and vacant units for this property
        const occupiedCount = await Unit.countDocuments({
            property: propertyId,
            status: 'occupied'
        });
        
        const vacantCount = await Unit.countDocuments({
            property: propertyId,
            status: 'vacant'
        });
        
        const totalCount = await Unit.countDocuments({ property: propertyId });
        
        // Update property
        await Property.findByIdAndUpdate(propertyId, {
            totalUnits: totalCount,
            occupiedUnits: occupiedCount,
            vacantUnits: vacantCount
        });
        
        return { totalCount, occupiedCount, vacantCount };
    } catch (error) {
        console.error('Error updating property unit counts:', error);
        throw error;
    }
};