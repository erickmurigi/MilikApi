import express from 'express';
import Company from '../models/Company.js';
import { generateAccessKeys } from '../utils/keyGenerator.js'; // helper to create unique keys

const router = express.Router();

// ------------------- GET all companies -------------------
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    const query = {};

    if (search) {
      query.$or = [
        { companyName: { $regex: search, $options: 'i' } },
        { registrationNo: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const companies = await Company.find(query)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });

    const total = await Company.countDocuments(query);

    res.json({
      companies,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ------------------- GET single company -------------------
router.get('/:id', async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }
    res.json(company);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ------------------- CREATE new company -------------------
router.post('/', async (req, res) => {
  try {
    // Transform incoming data to match schema
    const companyData = { ...req.body };

    // Handle modules: frontend sends { enabled: true } objects, we need booleans
    if (companyData.modules) {
      const moduleBooleans = {};
      for (const [key, value] of Object.entries(companyData.modules)) {
        moduleBooleans[key] = value.enabled || false;
      }
      companyData.modules = moduleBooleans;
    }

    // Handle fiscalPeriods similarly (if frontend sends object with booleans)
    if (companyData.fiscalPeriods) {
      // already booleans, no transformation needed
    }

    // Generate access keys
    const { adminKey, normalKey } = generateAccessKeys();
    companyData.accessKeys = [{ adminKey, normalKey, keyVersion: 'v1' }];

    // Set default status
    companyData.isActive = false; // requires activation later
    companyData.accountActive = true;

    const company = new Company(companyData);
    const savedCompany = await company.save();

    res.status(201).json(savedCompany);
  } catch (error) {
    // Handle duplicate key errors (e.g., registrationNo unique)
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Registration number already exists' });
    }
    res.status(400).json({ message: error.message });
  }
});

// ------------------- UPDATE company -------------------
router.put('/:id', async (req, res) => {
  try {
    const updates = { ...req.body };

    // Transform modules if present
    if (updates.modules) {
      const moduleBooleans = {};
      for (const [key, value] of Object.entries(updates.modules)) {
        moduleBooleans[key] = value.enabled || false;
      }
      updates.modules = moduleBooleans;
    }

    // Prevent updating accessKeys via this endpoint for security
    delete updates.accessKeys;

    const company = await Company.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    );

    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    res.json(company);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Duplicate field value' });
    }
    res.status(400).json({ message: error.message });
  }
});

// ------------------- DELETE company -------------------
router.delete('/:id', async (req, res) => {
  try {
    const company = await Company.findByIdAndDelete(req.params.id);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }
    res.json({ message: 'Company deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;