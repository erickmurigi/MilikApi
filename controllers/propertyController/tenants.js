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

        // Auto-generate tenant code if not provided
        let tenantCode = req.body.tenantCode;
        if (!tenantCode || tenantCode.trim() === '') {
            // Find all existing tenant codes for this business
            const existingTenants = await Tenant.find({ 
                business: req.user.company,
                tenantCode: { $regex: /^TT\d+$/ } // Match TT followed by numbers
            })
            .select('tenantCode')
            .lean();

            if (existingTenants && existingTenants.length > 0) {
                // Extract numbers from all codes and find the max
                const numbers = existingTenants
                    .map(t => parseInt(t.tenantCode.replace('TT', '')))
                    .filter(n => !isNaN(n));
                
                const maxNumber = Math.max(...numbers);
                const nextNumber = maxNumber + 1;
                tenantCode = `TT${String(nextNumber).padStart(4, '0')}`;
            } else {
                // First tenant for this business
                tenantCode = 'TT0001';
            }
        }

        // Security: Use authenticated user's company, not client-provided business
        const newTenant = new Tenant({ 
            ...req.body, 
            tenantCode,
            business: req.user.company 
        });
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
    const { status, unit } = req.query;
    try {
        // Security: Use authenticated user's company (system admins can query across companies)
        const business = req.user.isSystemAdmin && req.query.business ? req.query.business : req.user.company;
        const filter = { business };
        if (status) filter.status = status;
        if (unit) filter.unit = unit;

        const tenants = await Tenant.find(filter)
            .populate('unit', 'unitNumber property rent status utilities')
            .populate('unit.property', 'name address propertyName propertyType')
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
            .populate('unit', 'unitNumber property rent amenities status utilities')
            .populate('unit.property', 'name address propertyName propertyType');
        
        if (!tenant) return res.status(404).json({ message: "Tenant not found" });
        
        // Security: Verify tenant belongs to authenticated user's company
        if (tenant.business && tenant.business.toString() !== req.user.company?.toString()) {
            return res.status(403).json({ message: "Not authorized to access this tenant" });
        }
        
        res.status(200).json(tenant);
    } catch (err) {
        next(err);
    }
}

// Update tenant
export const updateTenant = async (req, res, next) => {
    try {
        const tenant = await Tenant.findById(req.params.id);
        
        if (!tenant) return res.status(404).json({ message: "Tenant not found" });
        
        // Security: Verify tenant belongs to authenticated user's company
        if (tenant.business && tenant.business.toString() !== req.user.company?.toString()) {
            return res.status(403).json({ message: "Not authorized to update this tenant" });
        }
        
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

        // Check if tenant has any rent payments/transactions
        const paymentCount = await RentPayment.countDocuments({ tenant: req.params.id });
        
        if (paymentCount > 0) {
            return res.status(400).json({
                success: false,
                message: `Cannot delete tenant with ${paymentCount} existing transaction(s). Please archive the tenant instead.`
            });
        }

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

// Migration endpoint: Assign tenant codes to existing tenants without codes
export const migrateTenantCodes = async (req, res, next) => {
    try {
        const business = req.user.company;

        // Find all tenants without tenant codes, sorted by creation date (oldest first)
        const tenantsWithoutCodes = await Tenant.find({
            business,
            $or: [
                { tenantCode: { $exists: false } },
                { tenantCode: null },
                { tenantCode: '' }
            ]
        }).sort({ createdAt: 1 }); // Oldest first

        if (tenantsWithoutCodes.length === 0) {
            return res.status(200).json({
                message: 'No tenants found without codes',
                updated: 0
            });
        }

        let updatedCount = 0;
        const updates = [];

        // Assign codes sequentially starting from TT0001
        for (let i = 0; i < tenantsWithoutCodes.length; i++) {
            const tenant = tenantsWithoutCodes[i];
            const tenantCode = `TT${String(i + 1).padStart(4, '0')}`;
            
            try {
                await Tenant.findByIdAndUpdate(tenant._id, { tenantCode });
                updatedCount++;
                updates.push({
                    tenantId: tenant._id,
                    tenantName: tenant.name,
                    assignedCode: tenantCode
                });
            } catch (err) {
                console.error(`Failed to update tenant ${tenant._id}:`, err);
            }
        }

        res.status(200).json({
            message: `Successfully assigned codes to ${updatedCount} tenants`,
            updated: updatedCount,
            details: updates
        });
    } catch (err) {
        next(err);
    }
};