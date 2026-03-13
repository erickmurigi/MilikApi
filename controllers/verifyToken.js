import jwt from "jsonwebtoken";
import { createError } from "../utils/error.js";

// Get JWT_SECRET with lazy validation
const getJWTSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  return secret;
};

// Verifies JWT from Authorization: Bearer <token>
export const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next(createError(401, "You are not authenticated!"));
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, getJWTSecret(), (err, user) => {
    if (err) return next(createError(403, "Token is not valid!"));

    req.user = user; // payload
    next();
  });
};

// Must be logged in (no further checks)
export const verifyUser = (req, res, next) => {
  verifyToken(req, res, next);
    console.log('VERIFYUSER: Incoming request:', req.method, req.originalUrl, 'Headers:', req.headers);
  };

// Admin only (adminAccess OR superAdminAccess)
export const verifyAdmin = (req, res, next) => {
  verifyToken(req, res, (err) => {
    if (err) return next(err);

    if (!req.user?.adminAccess && !req.user?.superAdminAccess) {
      return next(createError(403, "Admin access required"));
    }

    next();
  });
};

// Super Admin only (system-level access)
export const verifySuperAdmin = (req, res, next) => {
  verifyToken(req, res, (err) => {
    if (err) return next(err);

    if (!req.user?.superAdminAccess) {
      return next(createError(403, "Super Admin access required"));
    }

    next();
  });
};

// Verify company scope - ensures user can only access their own company's data
export const verifyCompanyScope = (req, res, next) => {
  verifyToken(req, res, (err) => {
    if (err) return next(err);

    // System admin can access all companies
    if (req.user?.isSystemAdmin) {
      return next();
    }

    // Ensure user has a company
    if (!req.user?.company) {
      return next(createError(403, "No company associated with user"));
    }

    // Attach company to request for controllers to use
    req.userCompany = req.user.company;
    next();
  });
};
