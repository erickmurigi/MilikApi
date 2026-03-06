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
            lastTenant: savedTenant._id // Store reference to tenant
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

// Bulk import tenants from Excel
export const bulkImportTenants = async (req, res, next) => {
    try {
        const { tenants: tenantsData, business } = req.body;
        
        console.log('=== TENANTS BULK IMPORT START ===');
        console.log('Business ID:', business);
        console.log('Tenants to import:', tenantsData?.length || 0);

        // Validation
        if (!business) {
            return res.status(400).json({ message: 'Business context is required' });
        }

        if (!Array.isArray(tenantsData) || tenantsData.length === 0) {
            return res.status(400).json({ message: 'No tenant data provided' });
        }

        if (tenantsData.length > 1000) {
            return res.status(400).json({ message: 'Maximum 1000 tenants per import' });
        }

        // Get all units for this business with their properties
        const units = await Unit.find({ business }).populate('property');
        console.log('Units found:', units.length);
        
        // Create a map of propertyCode+unitNumber to unit IDs for precise lookup
        const unitMap = new Map();
        units.forEach(unit => {
            const propertyCode = unit.property?.propertyCode?.toLowerCase();
            const unitNumber = unit.unitNumber?.toLowerCase();
            if (propertyCode && unitNumber) {
                const key = `${propertyCode}|${unitNumber}`;
                unitMap.set(key, unit._id);
            }
        });
        console.log('Unit map created with keys:', Array.from(unitMap.keys()).slice(0, 10));

        // Get existing tenants to check for duplicates
        const existingTenants = await Tenant.find({ business });
        const existingPhones = new Set(existingTenants.map(t => t.phone?.toLowerCase()));
        const existingIds = new Set(existingTenants.map(t => t.idNumber?.toLowerCase()));
        console.log('Existing phones:', existingPhones.size);
        console.log('Existing IDs:', existingIds.size);

        const successful = [];
        const failed = [];

        // Process each tenant
        for (const record of tenantsData) {
            console.log(`\nProcessing tenant: ${record.tenantName} (Property: ${record.propertyCode}, Unit: ${record.unitNumber})`);
            const rowIndex = tenantsData.indexOf(record) + 1;

            try {
                if (!record.propertyCode) {
                    const error = 'Property Code is required';
                    console.log(`  ❌ ${error}`);
                    failed.push({
                        tenantName: record.tenantName,
                        error,
                        row: rowIndex
                    });
                    continue;
                }

                // Find unit by Property Code + Unit Number
                const unitLookupKey = `${record.propertyCode.toLowerCase()}|${record.unitNumber.toLowerCase()}`;
                const unitId = unitMap.get(unitLookupKey);
                if (!unitId) {
                    const availableKeys = Array.from(unitMap.keys()).slice(0, 30);
                    const error = `Combination not found: Property "${record.propertyCode}" + Unit "${record.unitNumber}". Available combinations include: ${availableKeys.join(', ')}`;
                    console.log(`  ❌ ${error}`);
                    failed.push({
                        tenantName: record.tenantName,
                        error,
                        row: rowIndex
                    });
                    continue;
                }

                // Check for duplicate phone
                if (existingPhones.has(record.phoneNumber.toLowerCase())) {
                    const error = `Duplicate phone number: ${record.phoneNumber}`;
                    console.log(`  ❌ ${error}`);
                    failed.push({
                        tenantName: record.tenantName,
                        error,
                        row: rowIndex
                    });
                    continue;
                }

                // Check for duplicate ID number
                if (existingIds.has(record.idNumber.toLowerCase())) {
                    const error = `Duplicate ID number: ${record.idNumber}`;
                    console.log(`  ❌ ${error}`);
                    failed.push({
                        tenantName: record.tenantName,
                        error,
                        row: rowIndex
                    });
                    continue;
                }

                // Generate tenant code if needed
                let tenantCode = record.tenantCode;
                if (!tenantCode || tenantCode.trim() === '') {
                    const existingCodes = await Tenant.find({ 
                        business,
                        tenantCode: { $regex: /^TT\d+$/ } 
                    }).select('tenantCode').lean();

                    if (existingCodes && existingCodes.length > 0) {
                        const numbers = existingCodes
                            .map(t => parseInt(t.tenantCode.replace('TT', '')))
                            .filter(n => !isNaN(n));
                        
                        const maxNumber = Math.max(...numbers);
                        const nextNumber = maxNumber + 1;
                        tenantCode = `TT${String(nextNumber).padStart(4, '0')}`;
                    } else {
                        tenantCode = 'TT0001';
                    }
                }

                // Create new tenant
                const newTenant = new Tenant({
                    name: record.tenantName,
                    phone: record.phoneNumber,
                    idNumber: record.idNumber,
                    unit: unitId,
                    rent: record.rent || 0,
                    balance: 0,
                    status: record.status || 'active',
                    paymentMethod: record.paymentMethod || 'bank_transfer',
                    moveInDate: new Date(record.moveInDate),
                    moveOutDate: record.moveOutDate ? new Date(record.moveOutDate) : null,
                    tenantCode,
                    business,
                    emergencyContact: {
                        name: record.emergencyContactName || '',
                        phone: record.emergencyContactPhone || '',
                        relationship: ''
                    },
                    description: record.description || ''
                });

                await newTenant.save();

                // Update unit status to occupied
                const unitToUpdate = units.find(u => u._id.toString() === unitId.toString());
                if (unitToUpdate) {
                    await Unit.findByIdAndUpdate(unitId, {
                        status: 'occupied',
                        isVacant: false,
                        vacantSince: null,
                        daysVacant: 0,
                        lastTenant: newTenant._id
                    });

                    // Update property occupancy counts
                    const propertyId = unitToUpdate.property._id || unitToUpdate.property;
                    await Property.findByIdAndUpdate(propertyId, {
                        $inc: {
                            occupiedUnits: 1,
                            vacantUnits: -1
                        }
                    });
                }
                
                // Add to local tracking sets
                existingPhones.add(record.phoneNumber.toLowerCase());
                existingIds.add(record.idNumber.toLowerCase());

                console.log(`  ✓ Created successfully with code: ${tenantCode}`);
                
                successful.push({
                    tenantName: record.tenantName,
                    _id: newTenant._id,
                    tenantCode
                });

            } catch (error) {
                const errorMsg = error.message || 'Unknown error occurred';
                console.log(`  ❌ ${errorMsg}`);
                failed.push({
                    tenantName: record.tenantName,
                    error: errorMsg,
                    row: rowIndex
                });
            }
        }

        console.log('\n=== IMPORT COMPLETE ===');
        console.log(`Successful: ${successful.length}, Failed: ${failed.length}`);

        res.status(200).json({
            successful,
            failed,
            totalProcessed: tenantsData.length,
            successCount: successful.length,
            failureCount: failed.length
        });

    } catch (error) {
        console.error('Bulk import error:', error);
        return res.status(500).json({ message: error.message || 'Failed to process bulk import' });
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