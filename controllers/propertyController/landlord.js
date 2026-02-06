// controllers/landlordController.js
import Landlord from "../../models/Landlord.js";
import Property from "../../models/Property.js";
import Unit from "../../models/Unit.js";

// Create landlord
export const createLandlord = async(req, res, next) => {
    const newLandlord = new Landlord({...req.body, business: req.body.business});

    try {
        const savedLandlord = await newLandlord.save();
        res.status(200).json(savedLandlord);
    } catch (err) {
        next(err);
    }
}

// Get all landlords
export const getLandlords = async(req, res, next) => {
    const { business } = req.query;
    try {
        const landlords = await Landlord.find({ business }).sort({ createdAt: -1 });
        res.status(200).json(landlords);
    } catch (err) {
        next(err);
    }
}

// Get single landlord
export const getLandlord = async(req, res, next) => {
    try {
        const landlord = await Landlord.findById(req.params.id);
        if (!landlord) return res.status(404).json({ message: "Landlord not found" });
        res.status(200).json(landlord);
    } catch (err) {
        next(err);
    }
}

// Update landlord
export const updateLandlord = async(req, res, next) => {
    try {
        const updatedLandlord = await Landlord.findByIdAndUpdate(
            req.params.id,
            { $set: req.body },
            { new: true }
        );
        res.status(200).json(updatedLandlord);
    } catch (err) {
        next(err);
    }
}

// Delete landlord
export const deleteLandlord = async(req, res, next) => {
    try {
        // Check if landlord has properties
        const properties = await Property.find({ landlord: req.params.id });
        if (properties.length > 0) {
            return res.status(400).json({ 
                message: "Cannot delete landlord with existing properties" 
            });
        }
        
        await Landlord.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: "Landlord deleted successfully" });
    } catch (err) {
        next(err);
    }
}

// Get landlord dashboard stats
export const getLandlordStats = async(req, res, next) => {
    try {
        const landlordId = req.params.id;
        
        const totalProperties = await Property.countDocuments({ landlord: landlordId });
        const totalUnits = await Unit.countDocuments({ 
            property: { $in: await Property.find({ landlord: landlordId }).distinct('_id') }
        });
        const occupiedUnits = await Unit.countDocuments({ 
            property: { $in: await Property.find({ landlord: landlordId }).distinct('_id') },
            status: 'occupied'
        });
        const vacantUnits = await Unit.countDocuments({ 
            property: { $in: await Property.find({ landlord: landlordId }).distinct('_id') },
            status: 'vacant'
        });

        res.status(200).json({
            totalProperties,
            totalUnits,
            occupiedUnits,
            vacantUnits,
            occupancyRate: totalUnits > 0 ? (occupiedUnits / totalUnits) * 100 : 0
        });
    } catch (err) {
        next(err);
    }
}