// controllers/propertyController.js
import Property from "../../models/Property.js";
import Unit from "../../models/Unit.js";
import Tenant from "../../models/Tenant.js";

// Create property
export const createProperty = async (req, res) => {
  try {
    const {
      dateAcquired,
      letManage,
      landlords,
      propertyCode,
      propertyName,
      lrNumber,
      category,
      propertyType,
      specification,
      multiStoreyType,
      numberOfFloors,
      country,
      townCityState,
      estateArea,
      roadStreet,
      zoneRegion,
      address,
      accountLedgerType,
      primaryBank,
      alternativeTaxPin,
      invoicePrefix,
      invoicePaymentTerms,
      mpesaPaybill,
      disableMpesaStkPush,
      mpesaNarration,
      standingCharges,
      securityDeposits,
      smsExemptions,
      emailExemptions,
      excludeFeeSummary,
      drawerBank,
      bankBranch,
      accountName,
      accountNumber,
      notes,
      specificContactInfo,
      description,
      status,
      images
    } = req.body;

    // Check if property code already exists
    const existingProperty = await Property.findOne({ propertyCode });
    if (existingProperty) {
      return res.status(400).json({ 
        message: 'Property with this code already exists' 
      });
    }

    // Prepare banking details
    const bankingDetails = {
      drawerBank,
      bankBranch,
      accountName,
      accountNumber
    };

    // Create property
    const property = new Property({
      dateAcquired: dateAcquired ? new Date(dateAcquired) : null,
      letManage,
      landlords: landlords.map((landlord, index) => ({
        ...landlord,
        isPrimary: index === 0
      })),
      propertyCode,
      propertyName,
      lrNumber,
      category,
      propertyType,
      specification,
      multiStoreyType,
      numberOfFloors: numberOfFloors ? parseInt(numberOfFloors) : 0,
      country,
      townCityState,
      estateArea,
      roadStreet,
      zoneRegion,
      address: address || `${roadStreet}, ${estateArea}, ${townCityState}`,
      accountLedgerType,
      primaryBank,
      alternativeTaxPin,
      invoicePrefix,
      invoicePaymentTerms,
      mpesaPaybill,
      disableMpesaStkPush,
      mpesaNarration,
      standingCharges: standingCharges.map(charge => ({
        ...charge,
        chargeValue: parseFloat(charge.chargeValue) || 0,
        costPerArea: charge.costPerArea || ''
      })),
      securityDeposits: securityDeposits.map(deposit => ({
        ...deposit,
        amount: parseFloat(deposit.amount) || 0
      })),
      smsExemptions,
      emailExemptions,
      excludeFeeSummary,
      bankingDetails,
      notes,
      specificContactInfo,
      description: description || notes,
      status: status || 'active',
      images: images || [],
      business: req.user.business, // Assuming user has business field
      createdBy: req.user._id,
      updatedBy: req.user._id
    });

    const savedProperty = await property.save();
    
    res.status(201).json({
      success: true,
      data: savedProperty,
      message: 'Property created successfully'
    });
  } catch (error) {
    console.error('Create property error:', error);
    res.status(400).json({ 
      success: false,
      message: error.message 
    });
  }
};

// Get all properties
export const getProperties = async(req, res, next) => {
    try {
    const { page = 1, limit = 10, search, status } = req.query;
    const query = { business: req.user.business };
    
    if (search) {
      query.$or = [
        { propertyCode: { $regex: search, $options: 'i' } },
        { propertyName: { $regex: search, $options: 'i' } },
        { lrNumber: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (status) {
      query.status = status;
    }
    
    const properties = await Property.find(query)
      .populate('business', 'name')
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });
    
    const total = await Property.countDocuments(query);
    
    res.json({
      success: true,
      data: properties,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message 
    });
  }
}

// Get single property
export const getProperty = async(req, res, next) => {
    try {
    const property = await Property.findById(req.params.id)
      .populate('business', 'name')
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email');
    
    if (!property) {
      return res.status(404).json({ 
        success: false,
        message: 'Property not found' 
      });
    }
    
    // Check if property belongs to user's business
    if (property.business.toString() !== req.user.business.toString()) {
      return res.status(403).json({ 
        success: false,
        message: 'Not authorized to access this property' 
      });
    }
    
    res.json({
      success: true,
      data: property
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message 
    });
  }
}

// Update property
export const updateProperty = async(req, res, next) => {
    try {
    const property = await Property.findById(req.params.id);
    
    if (!property) {
      return res.status(404).json({ 
        success: false,
        message: 'Property not found' 
      });
    }
    
    // Check if property belongs to user's business
    if (property.business.toString() !== req.user.business.toString()) {
      return res.status(403).json({ 
        success: false,
        message: 'Not authorized to update this property' 
      });
    }
    
    // Check if property code is being changed and already exists
    if (req.body.propertyCode && req.body.propertyCode !== property.propertyCode) {
      const existingProperty = await Property.findOne({ 
        propertyCode: req.body.propertyCode 
      });
      if (existingProperty) {
        return res.status(400).json({ 
          success: false,
          message: 'Property with this code already exists' 
        });
      }
    }
    
    // Prepare banking details if provided
    if (req.body.drawerBank || req.body.bankBranch || req.body.accountName || req.body.accountNumber) {
      req.body.bankingDetails = {
        drawerBank: req.body.drawerBank || property.bankingDetails.drawerBank,
        bankBranch: req.body.bankBranch || property.bankingDetails.bankBranch,
        accountName: req.body.accountName || property.bankingDetails.accountName,
        accountNumber: req.body.accountNumber || property.bankingDetails.accountNumber
      };
    }
    
    // Update property
    Object.keys(req.body).forEach(key => {
      if (key !== 'drawerBank' && key !== 'bankBranch' && 
          key !== 'accountName' && key !== 'accountNumber') {
        property[key] = req.body[key];
      }
    });
    
    property.updatedBy = req.user._id;
    property.updatedAt = Date.now();
    
    const updatedProperty = await property.save();
    
    res.json({
      success: true,
      data: updatedProperty,
      message: 'Property updated successfully'
    });
  } catch (error) {
    res.status(400).json({ 
      success: false,
      message: error.message 
    });
  }
}

// Delete property
export const deleteProperty = async(req, res, next) => {
    try {
    const property = await Property.findById(req.params.id);
    
    if (!property) {
      return res.status(404).json({ 
        success: false,
        message: 'Property not found' 
      });
    }
    
    // Check if property belongs to user's business
    if (property.business.toString() !== req.user.business.toString()) {
      return res.status(403).json({ 
        success: false,
        message: 'Not authorized to delete this property' 
      });
    }
    
    // Check if property has any units
    const Unit = mongoose.model('Unit');
    const unitCount = await Unit.countDocuments({ property: property._id });
    
    if (unitCount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete property with existing units. Delete units first.'
      });
    }
    
    await property.deleteOne();
    
    res.json({
      success: true,
      message: 'Property deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message 
    });
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

