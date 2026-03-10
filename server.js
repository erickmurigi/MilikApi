import { Server } from "socket.io";
import { setIO } from "./utils/socketManager.js";
import express from "express";
import dotenv from "dotenv";
import helmet from 'helmet';
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/user.js";
import printerRoute from "./routes/printers.js";
import landlordRoutes from "./routes/propertyRoutes/landlords.js";
import unitRoutes from "./routes/propertyRoutes/units.js";  
import tenantRoutes from "./routes/propertyRoutes/tenants.js";
import rentPaymentRoutes from "./routes/propertyRoutes/rentPayments.js";
import maintenanceRoutes from "./routes/propertyRoutes/maintenance.js";
import leaseRoutes from "./routes/propertyRoutes/leases.js";
import expensePropertyRoutes from "./routes/propertyRoutes/expensesProperties.js";
import ledgerDiagnosticsRoutes from "./routes/propertyRoutes/ledgerDiagnostics.js";
import landlordPaymentRoutes from "./routes/propertyRoutes/landlordPayments.js";
import notificationRoutes from "./routes/propertyRoutes/notifications.js";
import utilityRoutes from "./routes/propertyRoutes/utilities.js";
import DashboardRoutes from "./controllers/propertyController/dashboard.js";
import propertyRoutes from "./routes/propertyRoutes/properties.js";
import http from "http";
import cors from "cors";
import companyRoutes from "./routes/companies.js";
import companySettingsRoutes from "./routes/companySettings.js";
import trialRoutes from './routes/trial.js';
dotenv.config();
const app = express();
app.use(express.json());
// Debug: Print admin credentials loaded from dotenv
console.log('DOTENV ADMIN DEBUG:', {
  MILIK_ADMIN_EMAIL: process.env.MILIK_ADMIN_EMAIL,
  MILIK_ADMIN_PASSWORD: process.env.MILIK_ADMIN_PASSWORD,
  MILIK_ADMIN_NAME: process.env.MILIK_ADMIN_NAME
});
const server = http.createServer(app);

// Define allowed origins for CORS
const allowedOrigins = [
  "http://localhost:5173",
  "https://betterbiz.netlify.app",
  "https://biznafitty.com",
  "https://sandbox.safaricom.co.ke",
  "https://gloriouspalacehotel.co.ke",
  "https://pup-enhanced-killdeer.ngrok-free.app"
];

function isAllowedLocalhostOrigin(origin) {
  // Allow all localhost ports for development
  return /^http:\/\/localhost:\d+$/.test(origin);
}

// Apply CORS globally before any routes
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || isAllowedLocalhostOrigin(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`The CORS policy for this site does not allow access from the specified Origin: ${origin}`), false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"]
}));

// Initialize Socket.IO
 const io = new Server(server, {
    cors: {
        origin: (origin, callback) => {
            if (!origin) return callback(null, true);
            if (
                allowedOrigins.includes(origin) ||
                isAllowedLocalhostOrigin(origin) ||
                [
                    "https://biznafitty.com",
                    "https://sandbox.safaricom.co.ke",
                    "https://gloriouspalacehotel.co.ke",
                    "https://pup-enhanced-killdeer.ngrok-free.app"
                ].includes(origin)
            ) {
                return callback(null, true);
            }
            return callback(new Error(`Socket.IO CORS blocked origin: ${origin}`));
        },
        methods: ["GET", "POST", "DELETE", "UPDATE"],
        credentials: true,
    },
});

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("joinCompany", (data) => {
        const { companyId, userId } = data;
        if (companyId) {
            socket.join(`company-${companyId}`);
            console.log(`User ${userId} joined company room: company-${companyId}`);
        }
        if (userId) {
            socket.join(`user-${userId}`);
            console.log(`User joined user room: user-${userId}`);
        }
    });

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
    });
});

// Register global IO instance for controllers
setIO(io);

// Middleware
app.use(helmet());
app.use(morgan("common"));

// Rate limiting configuration
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login attempts per windowMs
  message: { 
    success: false, 
    message: 'Too many login attempts, please try again after 15 minutes' 
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per 15 min (allows dashboard with many API calls)
  message: { 
    success: false, 
    message: 'Too many requests, please try again later' 
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply general rate limiting to all routes
app.use(generalLimiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'MILIK API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0'
  });
});

// API information endpoint
app.get('/api', (req, res) => {
  res.status(200).json({
    success: true,
    name: 'MILIK Property Management API',
    version: '1.0.0',
    description: 'RESTful API for property, tenant, and landlord management',
    endpoints: {
      auth: '/api/auth',
      users: '/api/users',
      companies: '/api/companies',
      properties: '/api/properties',
      units: '/api/units',
      tenants: '/api/tenants',
      landlords: '/api/landlords',
      leases: '/api/leases',
      rentPayments: '/api/rent-payments',
      maintenance: '/api/maintenances',
      expenses: '/api/propertyexpenses',
      utilities: '/api/utilities',
      paymentVouchers: '/api/payment-vouchers',
      notifications: '/api/notifications',
      dashboard: '/api/dashboard'
    },
    documentation: 'https://github.com/erickmurigi/MilikApi/blob/main/README.md'
  });
});

// Endpoints to access API

// Apply strict rate limiting to authentication endpoints

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', userRoutes);
app.use("/api/printers", printerRoute);
app.use("/api/landlords", landlordRoutes);
app.use("/api/properties", propertyRoutes);
app.use("/api/utilities", utilityRoutes);
app.use("/api/units", unitRoutes);
app.use("/api/tenants", tenantRoutes);
app.use("/api/rent-payments", rentPaymentRoutes);
app.use("/api/maintenances", maintenanceRoutes);
app.use("/api/leases", leaseRoutes);
app.use("/api/propertyexpenses", expensePropertyRoutes);
app.use("/api/ledger", ledgerDiagnosticsRoutes);
app.use("/api/landlord-payments", landlordPaymentRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/dashboard", DashboardRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/company-settings', companySettingsRoutes);
app.use('/api/trial', trialRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
    const errorStatus = err.status || 500;
    const errorMessage = err.message || "Something went wrong!";
    return res.status(errorStatus).json({
        success: false,
        status: errorStatus,
        message: errorMessage,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
});
  const connect = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URL);
        console.log("Connected to MongoDB");
    } catch (error) {
        console.error("Error connecting to MongoDB:", error);
        throw error;
    }
};

// Start the server on port 8800
const PORT = process.env.PORT || 8800;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});



