// routes/dashboard.js
import express from "express";
import Property from "../../models/Property.js";
import Tenant from "../../models/Tenant.js";
import RentPayment from "../../models/RentPayment.js";
import Maintenance from "../../models/Maintenance.js";
import Unit from "../../models/Unit.js";
import ExpenseProperty from "../../models/Expense.js";
import Lease from "../../models/Lease.js";
import Landlord from "../../models/Landlord.js";
import Utility from "../../models/Utility.js";

const router = express.Router();

// Get dashboard summary
router.get("/summary", async (req, res) => {
  try {
    const { business } = req.query;
    
    if (!business) {
      return res.status(400).json({ message: "Business ID is required" });
    }

    const [
      properties,
      tenants,
      payments,
      maintenances,
      units,
      expenses,
      leases,
      landlords,
      utilities
    ] = await Promise.all([
      Property.find({ business }),
      Tenant.find({ business }),
      RentPayment.find({ business }),
      Maintenance.find({ business }),
      Unit.find({ business }),
      ExpenseProperty.find({ business }),
      Lease.find({ business }),
      Landlord.find({ business }),
      Utility.find({ business })
    ]);

    // Calculate all statistics
    const totalUnits = units.length;
    const occupiedUnits = units.filter(unit => unit.status === 'occupied' || !unit.isVacant).length;
    const vacantUnits = totalUnits - occupiedUnits;
    
    const totalRevenue = payments
      .filter(p => p.isConfirmed && p.paymentType === 'rent')
      .reduce((sum, p) => sum + (p.amount || 0), 0);
    
    const totalDeposits = payments
      .filter(p => p.isConfirmed && p.paymentType === 'deposit')
      .reduce((sum, p) => sum + (p.amount || 0), 0);
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const monthlyRevenue = payments
      .filter(p => p.isConfirmed && p.paymentType === 'rent' && new Date(p.paymentDate) >= thirtyDaysAgo)
      .reduce((sum, p) => sum + (p.amount || 0), 0);

    const pendingPayments = payments.filter(p => !p.isConfirmed).length;
    const activeTenants = tenants.filter(t => t.status === 'active').length;
    const overdueTenants = tenants.filter(t => t.status === 'overdue' || t.balance > 0).length;
    const pendingMaintenance = maintenances.filter(m => m.status === 'pending').length;
    const completedMaintenance = maintenances.filter(m => m.status === 'completed').length;
    const activeLandlords = landlords.filter(l => l.status === 'active').length;
    const occupancyRate = totalUnits > 0 ? (occupiedUnits / totalUnits) * 100 : 0;
    
    const totalMonthlyRentDue = tenants.reduce((sum, t) => sum + (t.rent || 0), 0);
    const collectionRate = totalMonthlyRentDue > 0 ? (monthlyRevenue / totalMonthlyRentDue) * 100 : 0;

    // Current month expenses
    const now = new Date();
    const currentMonthExpenses = expenses
      .filter(e => {
        const expenseDate = new Date(e.date);
        return expenseDate.getMonth() === now.getMonth() && 
               expenseDate.getFullYear() === now.getFullYear();
      })
      .reduce((sum, e) => sum + (e.amount || 0), 0);
    
    const netProfit = monthlyRevenue - currentMonthExpenses;

    // Recent payments (last 10)
    const recentPayments = payments
      .filter(p => p.isConfirmed)
      .sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate))
      .slice(0, 10);

    // Upcoming maintenance (next 14 days)
    const today = new Date();
    const twoWeeksFromNow = new Date(today);
    twoWeeksFromNow.setDate(today.getDate() + 14);
    
    const upcomingMaintenance = maintenances
      .filter(m => m.scheduledDate && new Date(m.scheduledDate) <= twoWeeksFromNow && m.status === 'pending')
      .sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate))
      .slice(0, 10);

    // Expiring leases (next 60 days)
    const sixtyDaysFromNow = new Date(today);
    sixtyDaysFromNow.setDate(today.getDate() + 60);
    
    const expiringLeases = leases
      .filter(l => l.status === 'active' && new Date(l.endDate) <= sixtyDaysFromNow)
      .sort((a, b) => new Date(a.endDate) - new Date(b.endDate))
      .slice(0, 10);

    res.status(200).json({
      summary: {
        totalProperties: properties.length,
        totalUnits,
        occupiedUnits,
        vacantUnits,
        totalTenants: tenants.length,
        activeTenants,
        overdueTenants,
        totalRevenue,
        monthlyRevenue,
        pendingMaintenance,
        completedMaintenance,
        occupancyRate: parseFloat(occupancyRate.toFixed(1)),
        collectionRate: parseFloat(collectionRate.toFixed(1)),
        totalLandlords: landlords.length,
        activeLandlords,
        totalUtilities: utilities.length,
        pendingPayments,
        totalDeposits,
        netProfit
      },
      recentPayments,
      upcomingMaintenance,
      expiringLeases,
      properties,
      tenants,
      units
    });
  } catch (error) {
    console.error("Error fetching dashboard summary:", error);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;