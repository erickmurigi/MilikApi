import express from 'express';
import { 
  createCompany, 
  getAllCompanies, 
  getCompany, 
  updateCompany, 
  deleteCompany,
  getCompanyUsers 
} from '../controllers/company.js';
import { verifyUser } from '../controllers/verifyToken.js';

const router = express.Router();

// Admin-only routes (require verification)
router.post('/', verifyUser, createCompany); // Create company
router.get('/', verifyUser, getAllCompanies); // Get all companies (super admin only)
router.get('/:id', verifyUser, getCompany); // Get single company
router.put('/:id', verifyUser, updateCompany); // Update company
router.delete('/:id', verifyUser, deleteCompany); // Delete company (super admin only)
router.get('/:id/users', verifyUser, getCompanyUsers); // Get company users

export default router;