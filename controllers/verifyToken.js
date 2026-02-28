import jwt from "jsonwebtoken";
import { createError } from "../utils/error.js";

const JWT_SECRET = process.env.JWT || "milik-local-dev-jwt-secret";


// Verifies JWT from Authorization: Bearer <token>
export const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next(createError(401, "You are not authenticated!"));
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return next(createError(403, "Token is not valid!"));

    req.user = user; // payload
    next();
  });
};

// Must be logged in (no further checks)
export const verifyUser = (req, res, next) => {
  verifyToken(req, res, next);
};

// Admin only (expects payload to include isAdmin === true)
export const verifyAdmin = (req, res, next) => {
  verifyToken(req, res, (err) => {
    if (err) return next(err);

    if (!req.user?.isAdmin) {
      return next(createError(403, "You are not authorized!"));
    }

    next();
  });
};
