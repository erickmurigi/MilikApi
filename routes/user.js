import express from 'express';
import User from '../models/User.js';
import Company from '../models/Company.js';

const router = express.Router();

// Apply authentication to all user routes

// ------------------- GET all users for a company -------------------
router.get('/', async (req, res) => {
  try {
    const { companyId, page = 1, limit = 10, search } = req.query;
    
    if (!companyId) {
      return res.status(400).json({ message: 'companyId is required' });
    }

    // Optional: check if user has access to this company (depends on your auth logic)
    // For now, assume req.user has company access.

    const query = { company: companyId };
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
      .select('-password -resetPasswordToken -resetPasswordExpire'); // exclude sensitive fields

    const total = await User.countDocuments(query);

    res.json({
      users,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ------------------- GET single user by ID -------------------
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password -resetPasswordToken -resetPasswordExpire');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    // Optional: verify user belongs to a company the requester has access to
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ------------------- CREATE new user -------------------
router.post('/', async (req, res) => {
  try {
    const { company, email, ...otherData } = req.body;

    // Check if company exists
    const companyExists = await Company.findById(company);
    if (!companyExists) {
      return res.status(400).json({ message: 'Company not found' });
    }

    // Check if email already exists in this company
    const existingUser = await User.findOne({ company, email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already registered in this company' });
    }

    // Create user (password will be hashed by pre-save hook)
    const user = new User(req.body);
    await user.save();

    // Return user without password
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.resetPasswordToken;
    delete userResponse.resetPasswordExpire;

    res.status(201).json(userResponse);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Duplicate field value (email might already exist)' });
    }
    res.status(400).json({ message: error.message });
  }
});

// ------------------- UPDATE user -------------------
router.put('/:id', async (req, res) => {
  try {
    // Prevent updating password via this endpoint (use separate password reset)
    if (req.body.password) {
      delete req.body.password;
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).select('-password -resetPasswordToken -resetPasswordExpire');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Duplicate field value' });
    }
    res.status(400).json({ message: error.message });
  }
});

// ------------------- DELETE user -------------------
router.delete('/:id', async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ------------------- Toggle lock status -------------------
router.patch('/:id/toggle-lock', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    user.locked = !user.locked;
    await user.save();
    res.json({ locked: user.locked });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;