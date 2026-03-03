import express from "express";
const app = express();
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
dotenv.config();
import http from "http";
import { Server } from "socket.io";
import { setIO } from "./utils/socketManager.js";

// Routes


import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';


import printerRoute from "./routes/printers.js";

//property management routes
import landlordRoutes from "./routes/propertyRoutes/landlords.js"
import propertyRoutes from "./routes/propertyRoutes/properties.js"
import utilityRoutes from "./routes/propertyRoutes/utilities.js"
import unitRoutes from "./routes/propertyRoutes/units.js"
import tenantRoutes from "./routes/propertyRoutes/tenants.js"
import rentPaymentRoutes from "./routes/propertyRoutes/rentPayments.js"
import maintenanceRoutes from "./routes/propertyRoutes/maintenance.js"
import leaseRoutes from "./routes/propertyRoutes/leases.js"
import expensePropertyRoutes from "./routes/propertyRoutes/expensesProperties.js"
import notificationRoutes from "./routes/propertyRoutes/notifications.js"
import DashboardRoutes from "./controllers/propertyController/dashboard.js"
import companyRoutes from "./routes/companies.js";
// Import your Sale model

import ngrok from '@ngrok/ngrok';
import { log } from "console";

// In your server.js, add with other routes




const startServer = async () => {
  const server = http.createServer(app);
  
  // Set server timeout (2 minutes)
  server.timeout = 120000;
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  
  // Enhanced CORS configuration
const allowedOrigins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "https://milik.com",
    
];

const isAllowedLocalhostOrigin = (origin) => {
        if (!origin) return false;
        return /^http:\/\/localhost:\d+$/.test(origin);
};

// CORS middleware
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) === -1 && !isAllowedLocalhostOrigin(origin)) {
            const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    credentials: true,
    exposedHeaders: ["Authorization"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"],
    optionsSuccessStatus: 204
}));

// Explicitly handle OPTIONS preflight requests
app.options('*', cors({
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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Additional headers middleware
app.use((req, res, next) => {
    // Set CORS headers for all responses
    const origin = req.headers.origin;
    if (origin && (allowedOrigins.includes(origin) || isAllowedLocalhostOrigin(origin))) {
        res.header('Access-Control-Allow-Origin', origin);
    }
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    
    next();
});

  // Initialize Socket.IO
 const io = new Server(server, {
    cors: {
        origin: (origin, callback) => {
            if (!origin) return callback(null, true);
            if (
                allowedOrigins.includes(origin) ||
                isAllowedLocalhostOrigin(origin) ||
                [
                    "https://betterbiz.netlify.app",
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

app.use(express.json());

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
  max: 100, // Limit each IP to 100 requests per windowMs
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

//property management routes
app.use("/api/landlords", landlordRoutes)
app.use("/api/properties", propertyRoutes)
app.use("/api/utilities", utilityRoutes)
app.use("/api/units", unitRoutes)
app.use("/api/tenants", tenantRoutes)
app.use("/api/rent-payments", rentPaymentRoutes)
app.use("/api/maintenances", maintenanceRoutes)
app.use("/api/leases", leaseRoutes)
app.use("/api/propertyexpenses", expensePropertyRoutes)
app.use("/api/notifications", notificationRoutes)
app.use("/api/dashboard", DashboardRoutes)
app.use('/api/companies', companyRoutes);





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

console.log("Auto-deploy test successful! - " + new Date());

  try {
    await connect(); // MongoDB connection
    
    // Start the server on configured port
    const PORT = process.env.PORT || 8800;
    server.listen(PORT, () => {
      console.log(`✅ MILIK API Server running on port ${PORT}`);
      console.log(`📡 Health check: http://localhost:${PORT}/health`);
      console.log(`📚 API info: http://localhost:${PORT}/api`);
    });

  } catch (error) {
    console.error("Server startup failed:", error);
    process.exit(1);
  }
};

startServer();
// Connecting to MongoDB



