// controllers/propertyController.js
import mongoose from "mongoose";
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

    // Validate required fields
    if (!propertyCode?.trim() || !propertyName?.trim() || !lrNumber?.trim() || !propertyType?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Property Code, Name, LR Number, and Type are required fields'
      });
    }

    // Security: Use authenticated user's company, not client-provided business
    const businessId = req.user?.company;
    if (!businessId) {
      return res.status(400).json({
        success: false,
        message: "Business context is required to create a property. Please ensure you are logged in with a company account."
      });
    }

    // Prepare banking details
    const bankingDetails = {
      drawerBank: drawerBank || '',
      bankBranch: bankBranch || '',
      accountName: accountName || '',
      accountNumber: accountNumber || ''
    };

    // Get user ID from JWT (stored as 'id' or '_id') or request body
    const userId = req.user?.id || req.user?._id || req.body?.createdBy;
    const createdById = mongoose.Types.ObjectId.isValid(userId)
      ? userId
      : undefined;

    // Clean optional enum fields to avoid validation errors
    const cleanedData = {};
    if (specification && specification.trim() !== '') cleanedData.specification = specification;
    if (multiStoreyType && multiStoreyType.trim() !== '') cleanedData.multiStoreyType = multiStoreyType;
    if (category && category.trim() !== '') cleanedData.category = category;

    // Filter and validate landlords - only include entries with name
    const validLandlords = (landlords || [])
       .filter(landlord => {
         const landlordName = landlord?.name?.trim() || landlord?.landlordName?.trim() || '';
         return landlordName && landlordName.toLowerCase() !== 'default';
       })
      .map((landlord, index) => ({
        landlordId: landlord.landlordId || null, // Store the Landlord ID if provided
         name: (landlord?.name || landlord?.landlordName || '').trim(),
        contact: landlord.contact?.trim() || '',
        isPrimary: index === 0
      }));

    // Require at least one valid landlord
    if (validLandlords.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one landlord is required. Please select a landlord from the list.'
      });
    }

    // Filter and validate standing charges - only include entries with serviceCharge
    const validStandingCharges = (standingCharges || [])
      .filter(charge => charge?.serviceCharge?.trim())
      .map(charge => ({
        serviceCharge: charge.serviceCharge.trim(),
        chargeMode: charge.chargeMode || 'Monthly',
        billingCurrency: charge.billingCurrency || 'KES',
        costPerArea: charge.costPerArea?.trim() || '',
        chargeValue: Math.max(0, parseFloat(charge.chargeValue) || 0),
        vatRate: charge.vatRate || '16%',
        escalatesWithRent: charge.escalatesWithRent || false
      }));

    // Filter and validate security deposits - only include entries with type
    const validSecurityDeposits = (securityDeposits || [])
      .filter(deposit => deposit?.depositType?.trim())
      .map(deposit => ({
        depositType: deposit.depositType.trim(),
        amount: Math.max(0, parseFloat(deposit.amount) || 0),
        currency: deposit.currency || 'KES',
        refundable: deposit.refundable !== false,
        terms: deposit.terms?.trim() || ''
      }));

    // Create property with validated data
    const property = new Property({
      dateAcquired: dateAcquired ? new Date(dateAcquired) : null,
      letManage,
      landlords: validLandlords, // validLandlords is guaranteed to have at least one entry
      propertyCode,
      propertyName,
      lrNumber,
      ...cleanedData, // Only include non-empty optional enum fields
      propertyType,
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
      standingCharges: validStandingCharges,
      securityDeposits: validSecurityDeposits,
      smsExemptions,
      emailExemptions,
      excludeFeeSummary,
      bankingDetails,
      notes,
      specificContactInfo,
      description: description || notes,
      status: status || 'active',
      images: images || [],
      business: businessId,
      createdBy: createdById,
      updatedBy: createdById
    });

    const savedProperty = await property.save();
    
    res.status(201).json({
      success: true,
      data: savedProperty,
      message: 'Property created successfully'
    });
  } catch (error) {
    console.error('Create property error:', error);
    
    // Provide clear validation error messages
    let errorMessage = error.message || 'Failed to create property';
    let statusCode = 500;
    
    if (error.name === 'ValidationError' && error.errors) {
      const validationErrors = Object.values(error.errors)
        .filter(err => err && err.message)
        .map(err => err.message);
      if (validationErrors.length > 0) {
        errorMessage = validationErrors.join('; ');
        statusCode = 400;
      }
    } else if (error.code === 11000) {
      errorMessage = 'A property with this code already exists';
      statusCode = 400;
    } else if (error.statusCode) {
      statusCode = error.statusCode;
    }
    
    res.status(statusCode).json({ 
      success: false,
      message: errorMessage
    });
  }
};

// Get all properties
export const getProperties = async(req, res, next) => {
    try {
    const { page = 1, limit = 10, search, status } = req.query;
    
    // Security: Use authenticated user's company (system admins can query across companies)
    const businessId = req.user.isSystemAdmin && req.query.business 
      ? req.query.business 
      : req.user?.company;
      
    if (!businessId) {
      return res.status(400).json({
        success: false,
        message: "Business context is required to fetch properties"
      });
    }

    const query = { business: businessId };
    
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
      .populate('business', 'companyName')
      .populate('createdBy', 'surname otherNames email')
      .populate('updatedBy', 'surname otherNames email')
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
      .populate('business', 'companyName')
      .populate('createdBy', 'surname otherNames email')
      .populate('updatedBy', 'surname otherNames email');
    
    if (!property) {
      return res.status(404).json({ 
        success: false,
        message: 'Property not found' 
      });
    }
    
    // Security: Check if property belongs to user's business (system admins can access all)
    if (!req.user.isSystemAdmin) {
      const userBusinessId = req.user?.company;
      if (property.business.toString() !== userBusinessId?.toString()) {
        return res.status(403).json({ 
          success: false,
          message: 'Not authorized to access this property' 
        });
      }
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
    const userBusinessId = req.user?.company || req.user?.business;
    if (property.business.toString() !== userBusinessId?.toString()) {
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
    
    // Clean optional enum fields to avoid validation errors
    const optionalEnumFields = ['specification', 'multiStoreyType', 'category'];
    optionalEnumFields.forEach(field => {
      if (req.body[field] === '' || req.body[field] === null) {
        req.body[field] = undefined;
      }
    });

    // Validate landlords if being updated
    if (req.body.landlords) {
      const validLandlords = (req.body.landlords || [])
        .filter(landlord => landlord?.name?.trim() && landlord.name.trim().toLowerCase() !== 'default')
        .map((landlord, index) => ({
          landlordId: landlord.landlordId || null,
          name: landlord.name.trim(),
          contact: landlord.contact?.trim() || '',
          isPrimary: index === 0
        }));

      if (validLandlords.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'At least one valid landlord is required. Please select a landlord from the list.'
        });
      }

      req.body.landlords = validLandlords;
    }
    
    // Update property
    Object.keys(req.body).forEach(key => {
      if (key !== 'drawerBank' && key !== 'bankBranch' && 
          key !== 'accountName' && key !== 'accountNumber' && 
          req.body[key] !== undefined) {
        property[key] = req.body[key];
      }
    });
    
    // Get user ID from JWT (stored as 'id' or '_id')
    const userId = req.user?.id || req.user?._id;
    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      property.updatedBy = userId;
    }
    property.updatedAt = Date.now();
    
    const updatedProperty = await property.save();
    
    res.json({
      success: true,
      data: updatedProperty,
      message: 'Property updated successfully'
    });
  } catch (error) {
    console.error('Update property error:', error);
    
    // Provide clear validation error messages
    let errorMessage = error.message || 'Failed to update property';
    let statusCode = 500;
    
    if (error.name === 'ValidationError' && error.errors) {
      const validationErrors = Object.values(error.errors)
        .filter(err => err && err.message)
        .map(err => err.message);
      if (validationErrors.length > 0) {
        errorMessage = validationErrors.join('; ');
        statusCode = 400;
      }
    } else if (error.code === 11000) {
      errorMessage = 'A property with this code already exists';
      statusCode = 400;
    } else if (error.statusCode) {
      statusCode = error.statusCode;
    }
    
    res.status(statusCode).json({ 
      success: false,
      message: errorMessage 
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
    const userBusinessId = req.user?.company || req.user?.business;
    if (property.business.toString() !== userBusinessId?.toString()) {
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
            .populate('property', 'propertyName address')
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

