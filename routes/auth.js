import express from 'express';
import { validateRequest } from '../utils/validateRequest.js';
import { loginSchema, createUserSchema } from '../utils/validationSchemas.js';
import { 
  loginUser, 
  registerUser, 
  getCurrentUser, 
  logoutUser, 
  createSuperAdmin 
} from '../controllers/authController.js';
import { verifyUser } from '../controllers/verifyToken.js';

const router = express.Router();

// Public routes
router.post('/login', validateRequest(loginSchema), loginUser);
router.post('/super-admin', createSuperAdmin); // Create initial super admin only

// Protected routes
router.post('/', verifyUser, validateRequest(createUserSchema), registerUser); // Create new user (admin only)
router.get('/me', verifyUser, getCurrentUser); // Get current user
router.post('/logout', verifyUser, logoutUser); // Logout

export default router;
