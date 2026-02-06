// routes/property.js
import express from "express"
import { 
  createProperty, 
  getProperty, 
  getProperties, 
  updateProperty, 
  deleteProperty,
  getPropertyUnits,
  getPropertyTenants 
} from "../../controllers/propertyController/property.js"
import { verifyUser } from "../../controllers/verifyToken.js"

const router = express.Router()

// Create property
router.post("/",  createProperty)

// Get all properties
router.get("/", verifyUser, getProperties)

// Get single property
router.get("/:id", verifyUser, getProperty)

// Update property
router.put("/:id", verifyUser, updateProperty)

// Delete property
router.delete("/:id", verifyUser, deleteProperty)

// Get property units
router.get("/units/:id", verifyUser, getPropertyUnits)

// Get property tenants
router.get("/tenants/:id", verifyUser, getPropertyTenants)

export default router