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
         const hasLandlordId = landlord?.landlordId && mongoose.Types.ObjectId.isValid(landlord.landlordId);
         return landlordName && landlordName.toLowerCase() !== 'default' && hasLandlordId;
       })
      .map((landlord, index) => ({
        landlordId: landlord.landlordId, // Required - Store the Landlord ID
         name: (landlord?.name || landlord?.landlordName || '').trim(),
        contact: landlord.contact?.trim() || '',
        isPrimary: index === 0
      }));

    // Require at least one valid landlord with landlordId
    if (validLandlords.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one landlord with a valid landlordId is required. Please select a landlord from the list.'
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
    const { 
      page = 1, 
      limit = 10, 
      search, 
      status, 
      zone, 
      category, 
      code, 
      name, 
      lrNumber, 
      landlord, 
      location 
    } = req.query;
    
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
    const orConditions = [];
    
    // General search across multiple fields
    if (search) {
      orConditions.push(
        { propertyCode: { $regex: search, $options: 'i' } },
        { propertyName: { $regex: search, $options: 'i' } },
        { lrNumber: { $regex: search, $options: 'i' } }
      );
    }
    
    // Location search across address fields
    if (location) {
      orConditions.push(
        { address: { $regex: location, $options: 'i' } },
        { townCityState: { $regex: location, $options: 'i' } },
        { estateArea: { $regex: location, $options: 'i' } },
        { roadStreet: { $regex: location, $options: 'i' } }
      );
    }
    
    // Add OR conditions to query if any exist
    if (orConditions.length > 0) {
      query.$or = orConditions;
    }
    
    // Specific field filters (AND conditions)
    if (status) {
      query.status = status;
    }
    
    if (zone) {
      query.zoneRegion = { $regex: zone, $options: 'i' };
    }
    
    if (category) {
      query.propertyType = { $regex: category, $options: 'i' };
    }
    
    if (code) {
      query.propertyCode = { $regex: code, $options: 'i' };
    }
    
    if (name) {
      query.propertyName = { $regex: name, $options: 'i' };
    }
    
    if (lrNumber) {
      query.lrNumber = { $regex: lrNumber, $options: 'i' };
    }
    
    if (landlord) {
      // Filter by landlord ID in the landlords array
      query['landlords.landlordId'] = landlord;
    }
    
    const properties = await Property.find(query)
      .populate('business', 'companyName')
      .populate('createdBy', 'surname otherNames email')
      .populate('updatedBy', 'surname otherNames email')
      .populate('landlords.landlordId', '_id landlordName firstName lastName email')
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
        .filter(landlord => {
          const landlordName = landlord?.name?.trim() || '';
          const hasLandlordId = landlord?.landlordId && mongoose.Types.ObjectId.isValid(landlord.landlordId);
          return landlordName && landlordName.toLowerCase() !== 'default' && hasLandlordId;
        })
        .map((landlord, index) => ({
          landlordId: landlord.landlordId, // Required - Store the Landlord ID
          name: landlord.name.trim(),
          contact: landlord.contact?.trim() || '',
          isPrimary: index === 0
        }));

      if (validLandlords.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'At least one valid landlord with a valid landlordId is required. Please select a landlord from the list.'
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

// Bulk import properties
export const bulkImportProperties = async (req, res, next) => {
  try {
    const { properties, business } = req.body;
    
    // Validation
    if (!Array.isArray(properties) || properties.length === 0) {
      return res.status(400).json({ message: 'Properties array is required' });
    }
    
    if (properties.length > 1000) {
      return res.status(400).json({ message: 'Maximum 1000 properties per import' });
    }
    
    if (!business) {
      return res.status(400).json({ message: 'Business/Company ID is required' });
    }

    // Extract LR numbers and codes to check for duplicates
    const lrNumbers = properties
      .filter(p => p.lrNumber)
      .map(p => p.lrNumber);
    
    const providedCodes = properties
      .filter(p => p.propertyCode)
      .map(p => p.propertyCode);

    // Query for existing properties
    const existingByLR = await Property.find({ 
      lrNumber: { $in: lrNumbers },
      business: business
    });
    
    const existingByCodes = providedCodes.length > 0 
      ? await Property.find({ 
          propertyCode: { $in: providedCodes },
          business: business
        })
      : [];

    // Create Sets for O(1) lookup
    const existingLRNumbers = new Set(
      existingByLR.map(p => p.lrNumber)
    );
    const existingPropertyCodes = new Set(
      existingByCodes.map(p => p.propertyCode)
    );

    // Get the highest existing code number for auto-generation
    const allProperties = await Property.find({ business: business });
    let maxCodeNumber = 0;
    allProperties.forEach(prop => {
      if (prop.propertyCode && prop.propertyCode.startsWith('PRO')) {
        const num = parseInt(prop.propertyCode.substring(3));
        if (!isNaN(num) && num > maxCodeNumber) {
          maxCodeNumber = num;
        }
      }
    });

    const results = {
      successful: [],
      failed: [],
      totalProcessed: 0
    };

    // Track duplicates within current batch
    const seenCodesInBatch = new Set();
    const seenLRInBatch = new Set();

    for (const property of properties) {
      results.totalProcessed++;
      const errors = [];

      // Check LR Number duplicates (existing + batch)
      if (property.lrNumber) {
        if (existingLRNumbers.has(property.lrNumber) || seenLRInBatch.has(property.lrNumber)) {
          errors.push(`LR Number already exists: ${property.lrNumber}`);
        }
        seenLRInBatch.add(property.lrNumber);
      }

      // Check Property Code duplicates if provided
      if (property.propertyCode) {
        if (existingPropertyCodes.has(property.propertyCode) || seenCodesInBatch.has(property.propertyCode)) {
          errors.push(`Property Code already exists: ${property.propertyCode}`);
        }
        seenCodesInBatch.add(property.propertyCode);
      }

      if (errors.length > 0) {
        results.failed.push({
          propertyName: property.propertyName,
          error: errors.join('; ')
        });
        continue;
      }

      try {
        // Generate code if not provided
        let propertyCode = property.propertyCode;
        if (!propertyCode) {
          // Auto-generate: PRO001, PRO002, etc.
          let counter = maxCodeNumber + 1;
          propertyCode = `PRO${String(counter).padStart(3, '0')}`;
          while (existingPropertyCodes.has(propertyCode) || seenCodesInBatch.has(propertyCode)) {
            counter++;
            propertyCode = `PRO${String(counter).padStart(3, '0')}`;
          }
          maxCodeNumber = counter;
        }
        seenCodesInBatch.add(propertyCode);

        // Create property
        const newProperty = new Property({
          propertyCode,
          propertyName: property.propertyName,
          lrNumber: property.lrNumber,
          propertyType: property.propertyType || 'Residential',
          category: property.category,
          townCityState: property.townCityState,
          estateArea: property.estateArea,
          roadStreet: property.roadStreet,
          zoneRegion: property.zoneRegion,
          totalUnits: property.totalUnits || 0,
          country: 'Kenya',
          status: property.status || 'active',
          business: business,
          createdBy: req.user._id,
          
          // Add landlord if provided
          landlords: property.landlordName ? [{
            landlordId: null, // Will be looked up separately if needed
            name: property.landlordName,
            isPrimary: true
          }] : []
        });

        await newProperty.save();
        
        results.successful.push({
          propertyName: property.propertyName,
          code: propertyCode
        });
      } catch (error) {
        results.failed.push({
          propertyName: property.propertyName,
          error: error.message || 'Failed to create property'
        });
      }
    }

    res.status(200).json(results);
  } catch (err) {
    next(err);
  }
};

