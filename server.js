import express from "express";
const app = express();
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import bodyParser from "body-parser";
dotenv.config();
import http from "http";
import { Server } from "socket.io";

// Routes
import employeesAuthRoute from "./routes/employeesAuth.js";

import employeesRoute from "./routes/employees.js";
;


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
// Import your Sale model

import ngrok from '@ngrok/ngrok';
import { log } from "console";

// In your server.js, add with other routes




const startServer = async () => {
  const server = http.createServer(app);
  // Enhanced CORS configuration
const allowedOrigins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "https://milik.com",
    
];

// CORS middleware
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) === -1) {
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
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"]
}));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Or if you're using body-parser directly

app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
// Additional headers middleware
app.use((req, res, next) => {
    // Set CORS headers for all responses
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
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
        origin: [
            "http://localhost:5173",
            "http://localhost:5174",
            "https://betterbiz.netlify.app",
            "https://biznafitty.com",
            "https://sandbox.safaricom.co.ke",
            "https://gloriouspalacehotel.co.ke",
            "https://pup-enhanced-killdeer.ngrok-free.app"
        ],
        methods: ["GET", "POST", "DELETE", "UPDATE"],
        credentials: true,
    },
});

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
    });
});

// Middleware
app.use(helmet());
app.use(morgan("common"));

app.use(express.json());

// Endpoints to access API

app.use("/api/employeesAuth", employeesAuthRoute);

app.use("/api/employees", employeesRoute);

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






// Error handling middleware
app.use((err, req, res, next) => {
    const errorStatus = err.status || 500;
    const errorMessage = err.message || "Something wbbbbent wrong!";
    return res.status(errorStatus).json({
        success: false,
        status: errorStatus,
        message: errorMessage,
        stack: err.stack,
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
    
    // Start the server
    server.listen(8800, () => {
      console.log("Server running on port 8800");
      
     
    });

  } catch (error) {
    console.error("Server startup failed:", error);
    process.exit(1);
  }
};

startServer();
// Connecting to MongoDB



