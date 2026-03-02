// controllers/maintenanceController.js
import Maintenance from "../../models/Maintenance.js";
import { emitToCompany } from "../../utils/socketManager.js";

// Create maintenance request
export const createMaintenance = async(req, res, next) => {
    // Security: Use authenticated user's company, not client-provided business
    const newMaintenance = new Maintenance({...req.body, business: req.user.company});

    try {
        const savedMaintenance = await newMaintenance.save();
        emitToCompany(req.user.company, 'maintenance:new', savedMaintenance);
        res.status(200).json(savedMaintenance);
    } catch (err) {
        next(err);
    }
}

// Get all maintenance requests
export const getMaintenances = async(req, res, next) => {
    const { status, priority, unit, tenant } = req.query;
    try {
        // Security: Use authenticated user's company (system admins can query across companies)
        const business = req.user.isSystemAdmin && req.query.business ? req.query.business : req.user.company;
        const filter = { business };
        if (status) filter.status = status;
        if (priority) filter.priority = priority;
        if (unit) filter.unit = unit;
        if (tenant) filter.tenant = tenant;
        
        const maintenances = await Maintenance.find(filter)
            .populate('unit', 'unitNumber property')
            .populate('unit.property', 'name address')
            .populate('tenant', 'name phone')
            .populate('assignedTo', 'name phone')
            .sort({ priority: -1, createdAt: -1 });
        res.status(200).json(maintenances);
    } catch (err) {
        next(err);
    }
}

// Get single maintenance
export const getMaintenance = async(req, res, next) => {
    try {
        const maintenance = await Maintenance.findById(req.params.id)
            .populate('unit', 'unitNumber property')
            .populate('unit.property', 'name address landlord')
            .populate('tenant', 'name phone email')
            .populate('assignedTo', 'name phone email');
        if (!maintenance) return res.status(404).json({ message: "Maintenance request not found" });
        res.status(200).json(maintenance);
    } catch (err) {
        next(err);
    }
}

// Update maintenance
export const updateMaintenance = async(req, res, next) => {
    try {
        const updatedMaintenance = await Maintenance.findByIdAndUpdate(
            req.params.id,
            { $set: req.body },
            { new: true }
        );
        res.status(200).json(updatedMaintenance);
    } catch (err) {
        next(err);
    }
}

// Update maintenance status
export const updateMaintenanceStatus = async(req, res, next) => {
    try {
        const { status, completedDate, actualCost } = req.body;
        const updateData = { status };
        
        if (status === 'completed') {
            updateData.completedDate = completedDate || new Date();
            if (actualCost) updateData.actualCost = actualCost;
        }
        
        const updatedMaintenance = await Maintenance.findByIdAndUpdate(
            req.params.id,
            { $set: updateData },
            { new: true }
        );
        res.status(200).json(updatedMaintenance);
    } catch (err) {
        next(err);
    }
}

// Delete maintenance
export const deleteMaintenance = async(req, res, next) => {
    try {
        await Maintenance.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: "Maintenance request deleted successfully" });
    } catch (err) {
        next(err);
    }
}

// Get maintenance stats
export const getMaintenanceStats = async(req, res, next) => {
    const { business } = req.query;
    try {
        const total = await Maintenance.countDocuments({ business });
        const pending = await Maintenance.countDocuments({ business, status: 'pending' });
        const inProgress = await Maintenance.countDocuments({ business, status: 'in_progress' });
        const completed = await Maintenance.countDocuments({ business, status: 'completed' });
        const highPriority = await Maintenance.countDocuments({ business, priority: 'high' });
        
        const maintenanceCosts = await Maintenance.aggregate([
            { $match: { business: mongoose.Types.ObjectId(business), status: 'completed' } },
            { $group: { _id: null, totalCost: { $sum: "$actualCost" } } }
        ]);
        
        res.status(200).json({
            total,
            pending,
            inProgress,
            completed,
            highPriority,
            totalCost: maintenanceCosts[0]?.totalCost || 0
        });
    } catch (err) {
        next(err);
    }
}