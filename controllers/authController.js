// ========== REGISTER USER (Admin only) ===========
export const registerUser = async (req, res, next) => {
  try {
    const { email, password, surname, otherNames, phoneNumber, company, profile, idNumber } = req.body;

    if (!req.user?.superAdminAccess && !req.user?.adminAccess) {
      return next(createError(403, "Only admins can create users"));
    }

    if (!req.user?.superAdminAccess && req.user?.company && String(req.user.company) !== String(company)) {
      return next(createError(403, "Company admins can only create users in their own company"));
    }

    // Validate required fields
    if (!email || !password || !surname || !otherNames || !phoneNumber || !company) {
      return next(createError(400, "All required fields must be provided"));
    }

    // Check if company exists
    const companyExists = await Company.findById(company);
    if (!companyExists) {
      return next(createError(404, "Company not found"));
    }

    // Check if email already exists in this company
    const existingUser = await User.findOne({ 
      company, 
      email: email.toLowerCase() 
    });
    if (existingUser) {
      return next(createError(400, "Email already registered in this company"));
    }

    // Create new user (password will be hashed by pre-save hook)
    const newUser = new User({
      email: email.toLowerCase(),
      password,
      surname,
      otherNames,
      phoneNumber,
      company,
      profile: profile || "Agent",
      idNumber,
      isActive: true,
      locked: false
    });

    const savedUser = await newUser.save();

    // Return saved user without password
    const { password: pass, ...userDetails } = savedUser._doc;

    res.status(201).json({
      success: true,
      user: userDetails,
      message: "User registered successfully"
    });

  } catch (err) {
    if (err.code === 11000) {
      // Duplicate key error
      return next(createError(400, "Email already exists"));
    }
    console.error('Register error:', err);
    next(err);
  }
};
import User from "../models/User.js";
import Company from "../models/Company.js";
import { createError } from "../utils/error.js";
import jwt from "jsonwebtoken";

// Get JWT secret with lazy validation
const getJWTSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  return secret;
};

// Get admin credentials with lazy loading
const getAdminCredentials = () => {
  return {
    email: process.env.MILIK_ADMIN_EMAIL?.toLowerCase(),
    password: process.env.MILIK_ADMIN_PASSWORD,
    name: process.env.MILIK_ADMIN_NAME || "Milik Admin"
  };
};

// ========== LOGIN ==========
export const loginUser = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return next(createError(400, "Email and password are required"));
    }
    const normalizedEmail = String(email).toLowerCase().trim();
    // Centralized admin login logic
    const adminCreds = getAdminCredentials();
    if (
      adminCreds.email &&
      adminCreds.password &&
      normalizedEmail === adminCreds.email &&
      password === adminCreds.password
    ) {
      const token = jwt.sign(
        {
          id: "milik-admin",
          email: adminCreds.email,
          profile: "Administrator",
          superAdminAccess: true,
          adminAccess: true,
          isSystemAdmin: true,
          company: null,
        },
        getJWTSecret(),
        { expiresIn: "7d" }
      );
      return res.status(200).json({
        success: true,
        token,
        user: {
          _id: "milik-admin",
          email: adminCreds.email,
          surname: adminCreds.name,
          otherNames: "",
          profile: "Administrator",
          superAdminAccess: true,
          adminAccess: true,
          isSystemAdmin: true,
          company: { companyName: "Milik System" },
          isActive: true,
        },
        message: "Login successful"
      });
    }
    // Find user by email (case-insensitive)
    const user = await User.findOne({ email: normalizedEmail }).populate('company', 'companyName');
    if (!user) {
      return next(createError(401, "Invalid email or password"));
    }
    if (!user.isActive) {
      return next(createError(403, "User account is inactive"));
    }
    if (user.locked) {
      return next(createError(403, "User account is locked"));
    }
    const isPasswordCorrect = await user.comparePassword(password);
    if (!isPasswordCorrect) {
      return next(createError(401, "Invalid email or password"));
    }
    user.lastLogin = new Date();
    await user.save();
    const token = jwt.sign(
      {
        id: user._id,
        email: user.email,
        company: user.company._id,
        profile: user.profile,
        superAdminAccess: user.superAdminAccess,
        adminAccess: user.adminAccess,
      },
      getJWTSecret(),
      { expiresIn: '7d' }
    );
    const { password: pass, ...userDetails } = user._doc;
    res.status(200).json({
      success: true,
      token,
      user: userDetails,
      message: "Login successful"
    });
  } catch (err) {
    next(createError(500, `Login error: ${err.message}`));
  }
};

// ========== GET CURRENT USER ==========
export const getCurrentUser = async (req, res, next) => {
  try {
    if (req.user?.isSystemAdmin) {
      const adminCreds = getAdminCredentials();
      return res.status(200).json({
        success: true,
        user: {
          _id: "milik-admin",
          email: adminCreds.email,
          surname: adminCreds.name,
          otherNames: "",
          profile: "Administrator",
          superAdminAccess: true,
          adminAccess: true,
          isSystemAdmin: true,
          company: { companyName: "Milik Admin" },
          isActive: true,
        },
        message: "User retrieved successfully"
      });
    }

    const user = await User.findById(req.user.id)
      .populate('company', 'companyName companyCode baseCurrency')
      .select('-password -resetPasswordToken -resetPasswordExpire');

    if (!user) {
      return next(createError(404, "User not found"));
    }

    res.status(200).json({
      success: true,
      user,
      message: "User retrieved successfully"
    });

  } catch (err) {
    console.error('Get current user error:', err);
    next(err);
  }
};

// ========== LOGOUT ==========
export const logoutUser = async (req, res) => {
  try {
    // Since we're using tokens, logout is handled client-side
    res.status(200).json({
      success: true,
      message: "Logged out successfully"
    });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({
      success: false,
      message: "Logout failed"
    });
  }
};

// ========== SWITCH COMPANY ========== 
export const switchCompany = async (req, res, next) => {
  try {
    const { companyId } = req.body;
    const userId = req.user.id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.company = companyId;
    await user.save();

    // Create new token with updated company
    const token = jwt.sign(
      {
        id: user._id,
        email: user.email,
        company: companyId,
        profile: user.profile,
        superAdminAccess: user.superAdminAccess,
        adminAccess: user.adminAccess,
      },
      getJWTSecret(),
      { expiresIn: "7d" }
    );

    res.status(200).json({
      success: true,
      token,
      user: { ...user._doc, company: companyId },
      message: "Company switched successfully"
    });
  } catch (err) {
    next(err);
  }
};

// ========== CREATE INITIAL SUPER ADMIN ==========
export const createSuperAdmin = async (req, res, next) => {
  return next(createError(410, "Super admin creation is disabled. Use embedded Milik admin credentials to login."));
};
