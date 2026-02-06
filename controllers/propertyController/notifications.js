// controllers/notificationController.js
import Notification from "../../models/Notification.js";

// Create notification
export const createNotification = async(req, res, next) => {
    const newNotification = new Notification({...req.body, business: req.body.business});

    try {
        const savedNotification = await newNotification.save();
        res.status(200).json(savedNotification);
    } catch (err) {
        next(err);
    }
}

// Get all notifications
export const getNotifications = async(req, res, next) => {
    const { business, recipient, isRead, type } = req.query;
    try {
        const filter = { business };
        if (recipient) filter.recipient = recipient;
        if (isRead !== undefined) filter.isRead = isRead === 'true';
        if (type) filter.type = type;
        
        const notifications = await Notification.find(filter)
            .populate('recipient', 'name email')
            .sort({ createdAt: -1 });
        res.status(200).json(notifications);
    } catch (err) {
        next(err);
    }
}

// Get single notification
export const getNotification = async(req, res, next) => {
    try {
        const notification = await Notification.findById(req.params.id)
            .populate('recipient', 'name email');
        if (!notification) return res.status(404).json({ message: "Notification not found" });
        res.status(200).json(notification);
    } catch (err) {
        next(err);
    }
}

// Mark as read
export const markAsRead = async(req, res, next) => {
    try {
        const updatedNotification = await Notification.findByIdAndUpdate(
            req.params.id,
            { $set: { isRead: true } },
            { new: true }
        );
        res.status(200).json(updatedNotification);
    } catch (err) {
        next(err);
    }
}

// Mark all as read
export const markAllAsRead = async(req, res, next) => {
    const { recipient } = req.body;
    try {
        await Notification.updateMany(
            { recipient, isRead: false },
            { $set: { isRead: true } }
        );
        res.status(200).json({ message: "All notifications marked as read" });
    } catch (err) {
        next(err);
    }
}

// Delete notification
export const deleteNotification = async(req, res, next) => {
    try {
        await Notification.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: "Notification deleted successfully" });
    } catch (err) {
        next(err);
    }
}

// Get notification stats
export const getNotificationStats = async(req, res, next) => {
    const { recipient } = req.query;
    try {
        const total = await Notification.countDocuments({ recipient });
        const unread = await Notification.countDocuments({ recipient, isRead: false });
        const byType = await Notification.aggregate([
            { $match: { recipient } },
            { $group: {
                _id: "$type",
                count: { $sum: 1 }
            }}
        ]);
        
        res.status(200).json({
            total,
            unread,
            byType
        });
    } catch (err) {
        next(err);
    }
}