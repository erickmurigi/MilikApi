// controllers/leaseController.js
import Lease from "../../models/Lease.js";
import Tenant from "../../models/Tenant.js";

// Create lease
export const createLease = async(req, res, next) => {
    const newLease = new Lease({...req.body, business: req.body.business});

    try {
        const savedLease = await newLease.save();
        res.status(200).json(savedLease);
    } catch (err) {
        next(err);
    }
}

// Get all leases
export const getLeases = async(req, res, next) => {
    const { business, status, tenant, unit } = req.query;
    try {
        const filter = { business };
        if (status) filter.status = status;
        if (tenant) filter.tenant = tenant;
        if (unit) filter.unit = unit;
        
        const leases = await Lease.find(filter)
            .populate('tenant', 'name email phone')
            .populate('unit', 'unitNumber property')
            .populate('unit.property', 'name address')
            .sort({ startDate: -1 });
        res.status(200).json(leases);
    } catch (err) {
        next(err);
    }
}

// Get single lease
export const getLease = async(req, res, next) => {
    try {
        const lease = await Lease.findById(req.params.id)
            .populate('tenant', 'name email phone idNumber')
            .populate('unit', 'unitNumber property amenities')
            .populate('unit.property', 'name address landlord');
        if (!lease) return res.status(404).json({ message: "Lease not found" });
        res.status(200).json(lease);
    } catch (err) {
        next(err);
    }
}

// Update lease
export const updateLease = async(req, res, next) => {
    try {
        const updatedLease = await Lease.findByIdAndUpdate(
            req.params.id,
            { $set: req.body },
            { new: true }
        );
        res.status(200).json(updatedLease);
    } catch (err) {
        next(err);
    }
}

// Delete lease
export const deleteLease = async(req, res, next) => {
    try {
        await Lease.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: "Lease deleted successfully" });
    } catch (err) {
        next(err);
    }
}

// Sign lease
export const signLease = async(req, res, next) => {
    try {
        const { signedBy, signature } = req.body;
        const lease = await Lease.findById(req.params.id);
        
        if (!lease) return res.status(404).json({ message: "Lease not found" });
        
        const updateData = {};
        if (signedBy === 'tenant') {
            updateData.signedByTenant = true;
            updateData.tenantSignature = signature;
        } else if (signedBy === 'landlord') {
            updateData.signedByLandlord = true;
            updateData.landlordSignature = signature;
        }
        
        // If both parties have signed
        if ((lease.signedByTenant && signedBy === 'landlord') || 
            (lease.signedByLandlord && signedBy === 'tenant')) {
            updateData.signedDate = new Date();
            updateData.status = 'active';
        }
        
        const updatedLease = await Lease.findByIdAndUpdate(
            req.params.id,
            { $set: updateData },
            { new: true }
        );
        res.status(200).json(updatedLease);
    } catch (err) {
        next(err);
    }
}

// Get expiring leases
export const getExpiringLeases = async(req, res, next) => {
    const { business, days = 30 } = req.query;
    try {
        const today = new Date();
        const futureDate = new Date();
        futureDate.setDate(today.getDate() + parseInt(days));
        
        const leases = await Lease.find({
            business,
            status: 'active',
            endDate: { $gte: today, $lte: futureDate }
        })
        .populate('tenant', 'name email phone')
        .populate('unit', 'unitNumber property')
        .sort({ endDate: 1 });
        
        res.status(200).json(leases);
    } catch (err) {
        next(err);
    }
}

// Renew lease
export const renewLease = async(req, res, next) => {
    try {
        const { newEndDate, newRentAmount } = req.body;
        const lease = await Lease.findById(req.params.id);
        
        if (!lease) return res.status(404).json({ message: "Lease not found" });
        
        // Create new lease based on old one
        const newLease = new Lease({
            tenant: lease.tenant,
            unit: lease.unit,
            startDate: new Date(),
            endDate: newEndDate,
            rentAmount: newRentAmount || lease.rentAmount,
            depositAmount: lease.depositAmount,
            paymentDueDay: lease.paymentDueDay,
            lateFee: lease.lateFee,
            terms: lease.terms,
            status: 'active',
            business: lease.business
        });
        
        // Update old lease status
        await Lease.findByIdAndUpdate(req.params.id, { status: 'renewed' });
        
        const savedLease = await newLease.save();
        res.status(200).json(savedLease);
    } catch (err) {
        next(err);
    }
}