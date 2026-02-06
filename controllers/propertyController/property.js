// controllers/propertyController.js
import Property from "../../models/Property.js";
import Unit from "../../models/Unit.js";
import Tenant from "../../models/Tenant.js";

// Create property
export const createProperty = async (req, res) => {
  try {
    // Clean the request body
    const propertyData = { ...req.body };
    
    // If landlord is empty string, remove it or set to null
    if (propertyData.landlord === "") {
      propertyData.landlord = null;
      // OR delete propertyData.landlord;
    }
    
    const property = new Property(propertyData);
    await property.save();
    
    res.status(201).json(property);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Get all properties
export const getProperties = async(req, res, next) => {
    const { business, landlord } = req.query;
    try {
        const filter = { business };
        if (landlord) filter.landlord = landlord;
        
        const properties = await Property.find(filter)
            .populate('landlord', 'name phone email')
            .sort({ createdAt: -1 });
        res.status(200).json(properties);
    } catch (err) {
        next(err);
    }
}

// Get single property
export const getProperty = async(req, res, next) => {
    try {
        const property = await Property.findById(req.params.id)
            .populate('landlord', 'name phone email');
        if (!property) return res.status(404).json({ message: "Property not found" });
        res.status(200).json(property);
    } catch (err) {
        next(err);
    }
}

// Update property
export const updateProperty = async(req, res, next) => {
    try {
        const updatedProperty = await Property.findByIdAndUpdate(
            req.params.id,
            { $set: req.body },
            { new: true }
        ).populate('landlord', 'name phone email');
        res.status(200).json(updatedProperty);
    } catch (err) {
        next(err);
    }
}

// Delete property
export const deleteProperty = async(req, res, next) => {
    try {
        // Check if property has units
        const units = await Unit.find({ property: req.params.id });
        if (units.length > 0) {
            return res.status(400).json({ 
                message: "Cannot delete property with existing units" 
            });
        }
        
        await Property.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: "Property deleted successfully" });
    } catch (err) {
        next(err);
    }
}

// Get property units
export const getPropertyUnits = async(req, res, next) => {
    try {
        const units = await Unit.find({ property: req.params.id })
            .populate('property', 'name address')
            .sort({ unitNumber: 1 });
        res.status(200).json(units);
    } catch (err) {
        next(err);
    }
}

// Get property tenants
export const getPropertyTenants = async(req, res, next) => {
    try {
        const units = await Unit.find({ property: req.params.id }).distinct('_id');
        const tenants = await Tenant.find({ unit: { $in: units } })
            .populate('unit', 'unitNumber rent');
        res.status(200).json(tenants);
    } catch (err) {
        next(err);
    }
}

