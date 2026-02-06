import mongoose from "mongoose";


const LeaveSchema = new mongoose.Schema(
  {
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    type: { type: String, required: true }, // e.g., 'sick', 'annual', 'maternity'
    status: { type: String, required: true, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    reason: { type: String } 
  },
  { timestamps: true } 
);

// Define the main employee schema
const EmployeesSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },
    gender: { type: String },
    nationalID: { type: String, unique: true, default: "" },
    phoneNo: { type: String, unique: true, default: "" },
    email: { type: String },
    password: { type: String, required: true },
    image: { type: String },
    occupation: { type: String },
    salary: { type: Number },
    isAdmin: { type: Boolean, default: false },
    isSupportUser: { type: Boolean, default: false },
    isOwner: { type: Boolean, default: false },
    editSale: { type: Boolean, default: false },
    isSupervisor: { type: Boolean, default: false },
    handleStock: { type: Boolean, default: false },
    viewPayroll: { type: Boolean, default: false },
    viewBooking: { type: Boolean, default: false },
    viewExpenses: { type: Boolean, default: false },
    disableStock: { type: Boolean, default: false },
    viewSupplies: { type: Boolean, default: false },
    reviewStock: { type: Boolean, default: false },
     viewWholesale: { type: Boolean, default: false },
    viewEmployee: { type: Boolean, default: false },
    handleDelete: { type: Boolean, default: false },
    handleClearSale: { type: Boolean, default: false },
    handleDiscount: { type: Boolean, default: false },
    handleVoidDelete: { type: Boolean, default: false },
    handleTransfer: { type: Boolean, default: false },
    handleStore: { type: Boolean, default: false},
    editSP: { type: Boolean, default: false },
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business' },
    leaves: [LeaveSchema], // Use the LeaveSchema for the leaves array
     shiftAssignments: [{ 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "ShiftAssignment" 
    }]
  },
  { timestamps: true }
);

export default mongoose.model("Employee", EmployeesSchema);
