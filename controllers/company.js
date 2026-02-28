import Company from "../models/Company.js";
import User from "../models/User.js";
import { createError } from "../utils/error.js";

// ========== CREATE COMPANY (Admin only) ==========
export const createCompany = async (req, res, next) => {
  try {
    // Verify user is super admin
    if (!req.user.superAdminAccess) {
      return next(createError(403, "Only super admin can create companies"));
    }

    const {
      companyName,
      registrationNo,
      taxPIN,
      postalAddress,
      country = "Kenya",
      town,
      roadStreet,
      baseCurrency = "KES",
      taxRegime = "VAT",
      fiscalStartMonth = "January",
      fiscalStartYear,
      modules = {}
    } = req.body;

    // Validate required fields
    if (!companyName || !postalAddress) {
      return next(createError(400, "Company name and postal address are required"));
    }

    // Check if company with same name already exists
    const existingCompany = await Company.findOne({ companyName });
    if (existingCompany) {
      return next(createError(400, "Company with this name already exists"));
    }

    // Generate company code from name
    const companyCode = companyName
      .split(' ')
      .map(word => word.charAt(0).toUpperCase())
      .join('')
      .substring(0, 5);

    const newCompany = new Company({
      companyName,
      registrationNo,
      taxPIN,
      postalAddress,
      country,
      town,
      roadStreet,
      baseCurrency,
      taxRegime,
      fiscalStartMonth,
      fiscalStartYear: fiscalStartYear || new Date().getFullYear(),
      companyCode,
      modules: {
        propertyManagement: modules.propertyManagement || true,
        inventory: modules.inventory || false,
        accounts: modules.accounts || true,
        billing: modules.billing || true,
        ...modules
      }
    });

    const savedCompany = await newCompany.save();

    res.status(201).json({
      success: true,
      company: savedCompany,
      message: "Company created successfully"
    });

  } catch (err) {
    console.error('Create company error:', err);
    next(err);
  }
};

// ========== GET ALL COMPANIES (Super admin only) ==========
export const getAllCompanies = async (req, res, next) => {
  try {
    // Verify user is super admin
    if (!req.user.superAdminAccess) {
      return next(createError(403, "Only super admin can view all companies"));
    }

    const { page = 1, limit = 10, search } = req.query;

    let query = {};
    if (search) {
      query.$or = [
        { companyName: { $regex: search, $options: 'i' } },
        { registrationNo: { $regex: search, $options: 'i' } },
        { companyCode: { $regex: search, $options: 'i' } }
      ];
    }

    const companies = await Company.find(query)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });

    const total = await Company.countDocuments(query);

    res.status(200).json({
      success: true,
      companies,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        total
      },
      message: "Companies retrieved successfully"
    });

  } catch (err) {
    console.error('Get companies error:', err);
    next(err);
  }
};

// ========== GET SINGLE COMPANY ==========
export const getCompany = async (req, res, next) => {
  try {
    const company = await Company.findById(req.params.id);

    if (!company) {
      return next(createError(404, "Company not found"));
    }

    // Verify user belongs to this company or is super admin
    if (!req.user.superAdminAccess && req.user.company !== req.params.id) {
      return next(createError(403, "You can only view your own company"));
    }

    res.status(200).json({
      success: true,
      company,
      message: "Company retrieved successfully"
    });

  } catch (err) {
    console.error('Get company error:', err);
    next(err);
  }
};

// ========== UPDATE COMPANY (Admin only) ==========
export const updateCompany = async (req, res, next) => {
  try {
    const company = await Company.findById(req.params.id);

    if (!company) {
      return next(createError(404, "Company not found"));
    }

    // Verify user is admin of this company or super admin
    if (!req.user.superAdminAccess && req.user.company !== req.params.id) {
      return next(createError(403, "You can only edit your own company"));
    }

    // Update allowed fields
    const allowedFields = [
      'companyName',
      'registrationNo',
      'taxPIN',
      'taxExemptCode',
      'postalAddress',
      'country',
      'town',
      'roadStreet',
      'latitude',
      'longitude',
      'baseCurrency',
      'taxRegime',
      'fiscalStartMonth',
      'fiscalStartYear',
      'modules',
      'operationPeriodType'
    ];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        company[field] = req.body[field];
      }
    });

    const updatedCompany = await company.save();

    res.status(200).json({
      success: true,
      company: updatedCompany,
      message: "Company updated successfully"
    });

  } catch (err) {
    console.error('Update company error:', err);
    next(err);
  }
};

// ========== DELETE COMPANY (Super admin only) ==========
export const deleteCompany = async (req, res, next) => {
  try {
    // Verify user is super admin
    if (!req.user.superAdminAccess) {
      return next(createError(403, "Only super admin can delete companies"));
    }

    const company = await Company.findById(req.params.id);

    if (!company) {
      return next(createError(404, "Company not found"));
    }

    // Check if company has any users
    const userCount = await User.countDocuments({ company: req.params.id });
    if (userCount > 0) {
      return next(createError(400, `Cannot delete company with ${userCount} user(s). Remove all users first.`));
    }

    await Company.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: "Company deleted successfully"
    });

  } catch (err) {
    console.error('Delete company error:', err);
    next(err);
  }
};

// ========== GET COMPANY USERS ==========
export const getCompanyUsers = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, search } = req.query;

    // Verify user belongs to this company or is super admin
    if (!req.user.superAdminAccess && req.user.company !== req.params.id) {
      return next(createError(403, "You can only view your company's users"));
    }

    let query = { company: req.params.id };
    if (search) {
      query.$or = [
        { surname: { $regex: search, $options: 'i' } },
        { otherNames: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(query)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 })
      .select('-password -resetPasswordToken -resetPasswordExpire');

    const total = await User.countDocuments(query);

    res.status(200).json({
      success: true,
      users,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        total
      },
      message: "Company users retrieved successfully"
    });

  } catch (err) {
    console.error('Get company users error:', err);
    next(err);
  }
};
