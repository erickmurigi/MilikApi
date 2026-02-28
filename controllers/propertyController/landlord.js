// controllers/landlordController.js
import Landlord from "../../models/Landlord.js";
import Property from "../../models/Property.js";
import Unit from "../../models/Unit.js";

// Generate unique landlord code
const generateLandlordCode = async () => {
  let code;
  let exists = true;
  let counter = 1;
  
  while (exists) {
    code = `LL${String(counter).padStart(3, '0')}`;
    exists = await Landlord.findOne({ landlordCode: code });
    counter++;
  }
  
  return code;
};

// Create landlord
export const createLandlord = async(req, res, next) => {
    try {
        // Generate code if not provided
        let landlordCode = req.body.landlordCode?.trim();
        if (!landlordCode) {
            landlordCode = await generateLandlordCode();
        }

        const newLandlord = new Landlord({
            ...req.body,
            landlordCode,
            company: req.body.company || req.company?._id,
            createdBy: req.user?._id
        });

        const savedLandlord = await newLandlord.save();
        res.status(201).json({
            success: true,
            data: savedLandlord,
            message: "Landlord created successfully"
        });
    } catch (err) {
        console.error('Create landlord error:', err);
        res.status(500).json({
            success: false,
            message: err.message || "Error creating landlord",
            error: err
        });
    }
}

// Get all landlords
export const getLandlords = async(req, res, next) => {
    try {
        const { company, search, status } = req.query;
        
        let query = {};
        if (company) query.company = company;
        if (status) query.status = status;
        
        if (search) {
            query.$or = [
                { landlordName: { $regex: search, $options: 'i' } },
                { landlordCode: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { phoneNumber: { $regex: search, $options: 'i' } }
            ];
        }

        const landlords = await Landlord.find(query)
            .populate('company', 'name')
            .sort({ createdAt: -1 });
        
        res.status(200).json({
            success: true,
            data: landlords,
            count: landlords.length
        });
    } catch (err) {
        console.error('Get landlords error:', err);
        res.status(500).json({
            success: false,
            message: err.message || "Error fetching landlords",
            error: err
        });
    }
}

// Get single landlord
export const getLandlord = async(req, res, next) => {
    try {
        const landlord = await Landlord.findById(req.params.id)
            .populate('company', 'name')
            .populate('createdBy', 'name email');
        
        if (!landlord) {
            return res.status(404).json({ 
                success: false,
                message: "Landlord not found" 
            });
        }
        
        res.status(200).json({
            success: true,
            data: landlord
        });
    } catch (err) {
        console.error('Get single landlord error:', err);
        res.status(500).json({
            success: false,
            message: err.message || "Error fetching landlord",
            error: err
        });
    }
}

// Update landlord
export const updateLandlord = async(req, res, next) => {
    try {
        // Don't allow updating landlordCode
        const { landlordCode, ...updateData } = req.body;
        
        const updatedLandlord = await Landlord.findByIdAndUpdate(
            req.params.id,
            { $set: updateData },
            { new: true, runValidators: true }
        ).populate('company', 'name');
        
        if (!updatedLandlord) {
            return res.status(404).json({
                success: false,
                message: "Landlord not found"
            });
        }
        
        res.status(200).json({
            success: true,
            data: updatedLandlord,
            message: "Landlord updated successfully"
        });
    } catch (err) {
        console.error('Update landlord error:', err);
        res.status(500).json({
            success: false,
            message: err.message || "Error updating landlord",
            error: err
        });
    }
}

// Delete landlord
export const deleteLandlord = async(req, res, next) => {
    try {
        // Check if landlord has properties
        const properties = await Property.countDocuments({ 'landlords._id': req.params.id });
        if (properties > 0) {
            return res.status(400).json({ 
                success: false,
                message: `Cannot delete landlord with ${properties} existing properties`
            });
        }
        
        const deletedLandlord = await Landlord.findByIdAndDelete(req.params.id);
        
        if (!deletedLandlord) {
            return res.status(404).json({
                success: false,
                message: "Landlord not found"
            });
        }
        
        res.status(200).json({ 
            success: true,
            message: "Landlord deleted successfully",
            data: deletedLandlord
        });
    } catch (err) {
        console.error('Delete landlord error:', err);
        res.status(500).json({
            success: false,
            message: err.message || "Error deleting landlord",
            error: err
        });
    }
}

// Get landlord dashboard stats
export const getLandlordStats = async(req, res, next) => {
    try {
        const landlordId = req.params.id;
        
        const totalProperties = await Property.countDocuments({ 'landlords._id': landlordId });
        const totalUnits = await Unit.countDocuments({ 
            property: { $in: await Property.find({ 'landlords._id': landlordId }).distinct('_id') }
        });
        const occupiedUnits = await Unit.countDocuments({ 
            property: { $in: await Property.find({ 'landlords._id': landlordId }).distinct('_id') },
            status: 'occupied'
        });
        const vacantUnits = await Unit.countDocuments({ 
            property: { $in: await Property.find({ 'landlords._id': landlordId }).distinct('_id') },
            status: 'vacant'
        });

        res.status(200).json({
            success: true,
            data: {
                totalProperties,
                totalUnits,
                occupiedUnits,
                vacantUnits,
                occupancyRate: totalUnits > 0 ? ((occupiedUnits / totalUnits) * 100).toFixed(2) : 0
            }
        });
    } catch (err) {
        console.error('Get landlord stats error:', err);
        res.status(500).json({
            success: false,
            message: err.message || "Error fetching landlord stats",
            error: err
        });
    }
}