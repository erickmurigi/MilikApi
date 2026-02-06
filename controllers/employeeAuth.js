import Employee from "../models/Employee.js";
import Business from "../models/Business.js";
import bcrypt from "bcryptjs";
import { createError } from "../utils/error.js";
import jwt from "jsonwebtoken";

export const Register = async (req, res, next) => {
    try {
        const businessId = req.body.business;

        const salt = bcrypt.genSaltSync(10);
        const hash = bcrypt.hashSync(req.body.password, salt);

        const newEmployee = new Employee({
            ...req.body,
            password: hash,
            business: businessId,
        });

        const businessExists = await Business.findById(businessId);
        if (!businessExists) {
            return res.status(404).json({ message: "Business not found" });
        }

        const savedEmployee = await newEmployee.save();
        res.status(201).json(savedEmployee);
    } catch (err) {
        next(err);
    }
};

export const Login = async (req, res, next) => {
    try {
        const { username, password, businessId } = req.body;

        if (!businessId && username !== "Support") {
            return next(createError(400, "Business ID is required"));
        }

        let employee;

        if (username === "Support") {
            employee = await Employee.findOne({ username });
        } else {
            employee = await Employee.findOne({ username, business: businessId }).populate('business');
        }

        if (!employee) return next(createError(404, "Employee not found"));

        // Determine effective admin status (admin or accountant)
        const effectiveIsAdmin = employee.isAdmin || employee.occupation === "Accountant";

        // Apply business validation to admins AND accountants
        if (effectiveIsAdmin && username !== "Support") {
            if (!employee.business || employee.business._id.toString() !== businessId) {
                return next(createError(403, "Data Mismatch"));
            }
        }

        const isPasswordCorrect = await bcrypt.compare(password, employee.password);
        if (!isPasswordCorrect) return next(createError(404, "Incorrect password"));

        if (!process.env.JWT) {
            console.error("JWT secret is not defined in environment variables");
            return next(createError(500, "Server configuration error"));
        }

        // Include effectiveIsAdmin in the token
        const token = jwt.sign(
            { id: employee._id, isAdmin: effectiveIsAdmin },
            process.env.JWT,
            { expiresIn: '1d' }
        );

        const { password: pass, isAdmin, business, ...otherDetails } = employee._doc;

        // Send effectiveIsAdmin in the response
        res.status(200).json({
            details: { ...otherDetails },
            isAdmin: effectiveIsAdmin, // Reflects actual privileges
            token,
        });
    } catch (err) {
        console.error("Login error:", err);
        next(err);
    }
};

// Logout (not needed for token-based auth, but kept for reference)
export const Logout = async (req, res) => {
    // Since we're using tokens, logout is handled client-side by clearing localStorage
    res.status(200).json({ message: "User has been logged out." });
};