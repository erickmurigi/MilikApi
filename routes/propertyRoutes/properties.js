// routes/property.js
import express from "express"
import { validateRequest } from "../../utils/validateRequest.js"
import { createPropertySchema, updatePropertySchema } from "../../utils/validationSchemas.js"
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
router.post("/", verifyUser, validateRequest(createPropertySchema), createProperty)

// Get all properties
router.get("/", verifyUser, getProperties)

// Get single property
router.get("/:id", verifyUser, getProperty)

// Update property
router.put("/:id", verifyUser, validateRequest(updatePropertySchema), updateProperty)

// Delete property
router.delete("/:id", verifyUser, deleteProperty)

// Get property units
router.get("/units/:id",getPropertyUnits)

// Get property tenants
router.get("/tenants/:id",  getPropertyTenants)

export default router