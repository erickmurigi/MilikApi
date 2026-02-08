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


const router = express.Router()

// Create property
router.post("/",  createProperty)

// Get all properties
router.get("/",  getProperties)

// Get single property
router.get("/:id",  getProperty)

// Update property
router.put("/:id", updateProperty)

// Delete property
router.delete("/:id",  deleteProperty)

// Get property units
router.get("/units/:id",getPropertyUnits)

// Get property tenants
router.get("/tenants/:id",  getPropertyTenants)

export default router