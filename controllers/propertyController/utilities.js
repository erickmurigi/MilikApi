// controllers/utilityController.js
import Utility from "../../models/Utility.js";

// Create utility
export const createUtility = async(req, res, next) => {
    const newUtility = new Utility({...req.body, business: req.body.business});

    try {
        const savedUtility = await newUtility.save();
        res.status(200).json(savedUtility);
    } catch (err) {
        next(err);
    }
}

// Get all utilities
export const getUtilities = async(req, res, next) => {
    const { business } = req.query;
    try {
        const utilities = await Utility.find({ business }).sort({ name: 1 });
        res.status(200).json(utilities);
    } catch (err) {
        next(err);
    }
}

// Get single utility
export const getUtility = async(req, res, next) => {
    try {
        const utility = await Utility.findById(req.params.id);
        if (!utility) return res.status(404).json({ message: "Utility not found" });
        res.status(200).json(utility);
    } catch (err) {
        next(err);
    }
}

// Update utility
export const updateUtility = async(req, res, next) => {
    try {
        const updatedUtility = await Utility.findByIdAndUpdate(
            req.params.id,
            { $set: req.body },
            { new: true }
        );
        res.status(200).json(updatedUtility);
    } catch (err) {
        next(err);
    }
}

// Delete utility
export const deleteUtility = async(req, res, next) => {
    try {
        await Utility.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: "Utility deleted successfully" });
    } catch (err) {
        next(err);
    }
}