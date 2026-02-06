// controllers/expensePropertyController.js
import ExpenseProperty from "../../models/ExpenseProperty.js";

// Create expense
export const createExpense = async(req, res, next) => {
    const newExpense = new ExpenseProperty({...req.body, business: req.body.business});

    try {
        const savedExpense = await newExpense.save();
        res.status(200).json(savedExpense);
    } catch (err) {
        next(err);
    }
}

// Get all expenses
export const getExpenses = async(req, res, next) => {
    const { business, category, property, unit, startDate, endDate } = req.query;
    try {
        const filter = { business };
        if (category) filter.category = category;
        if (property) filter.property = property;
        if (unit) filter.unit = unit;
        
        // Date filtering
        if (startDate || endDate) {
            filter.date = {};
            if (startDate) filter.date.$gte = new Date(startDate);
            if (endDate) filter.date.$lte = new Date(endDate);
        }
        
        const expenses = await ExpenseProperty.find(filter)
            .populate('property', 'name address')
            .populate('unit', 'unitNumber')
            .sort({ date: -1 });
        res.status(200).json(expenses);
    } catch (err) {
        next(err);
    }
}

// Get single expense
export const getExpense = async(req, res, next) => {
    try {
        const expense = await ExpenseProperty.findById(req.params.id)
            .populate('property', 'name address landlord')
            .populate('unit', 'unitNumber');
        if (!expense) return res.status(404).json({ message: "Expense not found" });
        res.status(200).json(expense);
    } catch (err) {
        next(err);
    }
}

// Update expense
export const updateExpense = async(req, res, next) => {
    try {
        const updatedExpense = await ExpenseProperty.findByIdAndUpdate(
            req.params.id,
            { $set: req.body },
            { new: true }
        );
        res.status(200).json(updatedExpense);
    } catch (err) {
        next(err);
    }
}

// Delete expense
export const deleteExpense = async(req, res, next) => {
    try {
        await ExpenseProperty.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: "Expense deleted successfully" });
    } catch (err) {
        next(err);
    }
}

// Get expense summary
export const getExpenseSummary = async(req, res, next) => {
    const { business, startDate, endDate } = req.query;
    try {
        const match = { business };
        if (startDate || endDate) {
            match.date = {};
            if (startDate) match.date.$gte = new Date(startDate);
            if (endDate) match.date.$lte = new Date(endDate);
        }
        
        const expenses = await ExpenseProperty.aggregate([
            { $match: match },
            { $group: {
                _id: "$category",
                totalAmount: { $sum: "$amount" },
                count: { $sum: 1 }
            }},
            { $sort: { totalAmount: -1 } }
        ]);
        
        const total = await ExpenseProperty.aggregate([
            { $match: match },
            { $group: {
                _id: null,
                totalAmount: { $sum: "$amount" },
                count: { $sum: 1 }
            }}
        ]);
        
        res.status(200).json({
            categories: expenses,
            totalAmount: total[0]?.totalAmount || 0,
            totalCount: total[0]?.count || 0
        });
    } catch (err) {
        next(err);
    }
}

// Get expenses by property
export const getPropertyExpenses = async(req, res, next) => {
    const { propertyId } = req.params;
    const { startDate, endDate } = req.query;
    
    try {
        const filter = { property: propertyId };
        if (startDate || endDate) {
            filter.date = {};
            if (startDate) filter.date.$gte = new Date(startDate);
            if (endDate) filter.date.$lte = new Date(endDate);
        }
        
        const expenses = await ExpenseProperty.find(filter)
            .populate('unit', 'unitNumber')
            .sort({ date: -1 });
            
        const summary = await ExpenseProperty.aggregate([
            { $match: filter },
            { $group: {
                _id: "$category",
                totalAmount: { $sum: "$amount" }
            }}
        ]);
        
        res.status(200).json({
            expenses,
            summary
        });
    } catch (err) {
        next(err);
    }
}