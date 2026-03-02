import { z } from 'zod';

// ========== USER SCHEMAS ==========
export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters")
});

export const createUserSchema = z.object({
  surname: z.string().min(1, "Surname is required"),
  otherNames: z.string().min(1, "Other names are required"),
  idNumber: z.string().min(1, "ID number is required"),
  phoneNumber: z.string().min(10, "Valid phone number is required"),
  email: z.string().email("Invalid email address"),
  profile: z.enum(['Administrator', 'Manager', 'Accountant', 'Agent', 'Viewer']),
  password: z.string().min(8, "Password must be at least 8 characters"),
  company: z.string().min(1, "Company is required")
});

// ========== PROPERTY SCHEMAS ==========
export const createPropertySchema = z.object({
  propertyCode: z.string().min(1, "Property code is required"),
  propertyName: z.string().min(1, "Property name is required"),
  category: z.string().min(1, "Category is required"),
  propertyType: z.string().min(1, "Property type is required"),
  country: z.string().min(1, "Country is required"),
  townCityState: z.string().min(1, "Town/City/State is required"),
  address: z.string().optional(),
  status: z.enum(['Active', 'Inactive']).default('Active')
});

export const updatePropertySchema = createPropertySchema.partial();

// ========== UNIT SCHEMAS ==========
export const createUnitSchema = z.object({
  unitNumber: z.string().min(1, "Unit number is required"),
  property: z.string().min(1, "Property ID is required"),
  rent: z.number().min(0, "Rent must be a positive number"),
  status: z.enum(['vacant', 'occupied', 'maintenance']).default('vacant'),
  bedrooms: z.number().optional(),
  bathrooms: z.number().optional()
});

export const updateUnitSchema = createUnitSchema.partial();

// ========== TENANT SCHEMAS ==========
export const createTenantSchema = z.object({
  name: z.string().min(1, "Tenant name is required"),
  email: z.string().email("Invalid email address").optional(),
  phone: z.string().min(10, "Valid phone number is required"),
  idNumber: z.string().min(1, "ID number is required"),
  unit: z.string().min(1, "Unit ID is required"),
  leaseStartDate: z.string().or(z.date()),
  leaseEndDate: z.string().or(z.date()),
  rentAmount: z.number().min(0, "Rent must be a positive number"),
  securityDeposit: z.number().min(0, "Security deposit must be a positive number").optional()
});

export const updateTenantSchema = createTenantSchema.partial();

// ========== LANDLORD SCHEMAS ==========
export const createLandlordSchema = z.object({
  landlordName: z.string().min(1, "Landlord name is required"),
  email: z.string().email("Invalid email address").optional(),
  phoneNumber: z.string().min(10, "Valid phone number is required"),
  regId: z.string().optional(),
  pinNumber: z.string().optional(),
  address: z.string().optional(),
  status: z.enum(['Active', 'Inactive']).default('Active')
});

export const updateLandlordSchema = createLandlordSchema.partial();

// ========== RENT PAYMENT SCHEMAS ==========
export const createPaymentSchema = z.object({
  tenant: z.string().min(1, "Tenant ID is required"),
  unit: z.string().min(1, "Unit ID is required"),
  amount: z.number().min(0, "Amount must be a positive number"),
  paymentDate: z.string().or(z.date()),
  paymentMethod: z.enum(['Cash', 'Bank Transfer', 'M-Pesa', 'Cheque', 'Card']),
  month: z.number().min(1).max(12),
  year: z.number().min(2000),
  receiptNumber: z.string().optional()
});

// ========== COMPANY SCHEMAS ==========
export const createCompanySchema = z.object({
  companyName: z.string().min(1, "Company name is required"),
  email: z.string().email("Invalid email address"),
  phoneNumber: z.string().min(10, "Valid phone number is required"),
  address: z.string().optional(),
  registrationNumber: z.string().optional(),
  taxPin: z.string().optional()
});

export const updateCompanySchema = createCompanySchema.partial();

// ========== MAINTENANCE SCHEMAS ==========
export const createMaintenanceSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  unit: z.string().min(1, "Unit ID is required"),
  priority: z.enum(['Low', 'Medium', 'High', 'Urgent']).default('Medium'),
  status: z.enum(['Pending', 'In Progress', 'Completed', 'Cancelled']).default('Pending'),
  tenant: z.string().optional()
});

// ========== LEASE SCHEMAS ==========
export const createLeaseSchema = z.object({
  tenant: z.string().min(1, "Tenant ID is required"),
  unit: z.string().min(1, "Unit ID is required"),
  startDate: z.string().or(z.date()),
  endDate: z.string().or(z.date()),
  rentAmount: z.number().min(0, "Rent must be a positive number"),
  securityDeposit: z.number().min(0, "Security deposit must be positive").optional(),
  status: z.enum(['Active', 'Expired', 'Terminated']).default('Active')
});

// ========== EXPENSE SCHEMAS ==========
export const createExpenseSchema = z.object({
  category: z.string().min(1, "Category is required"),
  amount: z.number().min(0, "Amount must be a positive number"),
  date: z.string().or(z.date()),
  description: z.string().min(1, "Description is required"),
  property: z.string().optional(),
  unit: z.string().optional(),
  vendor: z.string().optional()
});

// ========== UTILITY SCHEMAS ==========
export const createUtilitySchema = z.object({
  name: z.string().min(1, "Utility name is required"),
  type: z.enum(['Water', 'Electricity', 'Gas', 'Internet', 'Security', 'Other']),
  fixedAmount: z.boolean().default(false),
  amount: z.number().min(0, "Amount must be a positive number").optional(),
  billingCycle: z.enum(['Monthly', 'Quarterly', 'Annually']).default('Monthly')
});
