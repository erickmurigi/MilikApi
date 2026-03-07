import PaymentVoucher from "../../models/PaymentVoucher.js";
import { emitToCompany } from "../../utils/socketManager.js";

const generateVoucherNo = async (businessId) => {
  const prefix = "PV";
  const lastVoucher = await PaymentVoucher.findOne(
    { business: businessId, voucherNo: { $regex: `^${prefix}\\d+$` } },
    { voucherNo: 1 },
    { sort: { createdAt: -1 } }
  );

  let seq = 1;
  if (lastVoucher?.voucherNo) {
    seq = (parseInt(lastVoucher.voucherNo.replace(prefix, ""), 10) || 0) + 1;
  }

  return `${prefix}${String(seq).padStart(5, "0")}`;
};

export const createPaymentVoucher = async (req, res, next) => {
  try {
    const businessId = req.user.company;
    if (!businessId) {
      return res.status(400).json({ success: false, message: "User must have a company context" });
    }

    const voucherNo = await generateVoucherNo(businessId);
    const payload = {
      ...req.body,
      voucherNo,
      business: businessId,
    };

    const voucher = await new PaymentVoucher(payload).save();

    emitToCompany(businessId, "voucher:new", { voucherId: voucher._id });
    res.status(201).json(voucher);
  } catch (err) {
    next(err);
  }
};

export const getPaymentVouchers = async (req, res, next) => {
  try {
    const business = req.user.company;
    if (!business) {
      return res.status(400).json({ success: false, message: "User must have a company context" });
    }

    const { category, status, property, landlord, search } = req.query;
    const filter = { business };
    if (category) filter.category = category;
    if (status) filter.status = status;
    if (property) filter.property = property;
    if (landlord) filter.landlord = landlord;

    if (search) {
      const term = String(search).trim();
      filter.$or = [
        { voucherNo: { $regex: term, $options: "i" } },
        { reference: { $regex: term, $options: "i" } },
        { narration: { $regex: term, $options: "i" } },
      ];
    }

    const rows = await PaymentVoucher.find(filter)
      .populate("property", "propertyName name")
      .populate("landlord", "name landlordName")
      .sort({ createdAt: -1 });

    res.status(200).json(rows);
  } catch (err) {
    next(err);
  }
};

export const getPaymentVoucher = async (req, res, next) => {
  try {
    const business = req.user.company;
    if (!business) {
      return res.status(400).json({ success: false, message: "User must have a company context" });
    }

    const row = await PaymentVoucher.findOne({ _id: req.params.id, business })
      .populate("property", "propertyName name")
      .populate("landlord", "name landlordName")
      .populate("approvedBy", "surname otherNames email")
      .populate("paidBy", "surname otherNames email")
      .populate("reversedBy", "surname otherNames email");

    if (!row) return res.status(404).json({ message: "Payment voucher not found" });
    res.status(200).json(row);
  } catch (err) {
    next(err);
  }
};

export const updatePaymentVoucher = async (req, res, next) => {
  try {
    const business = req.user.company;
    if (!business) {
      return res.status(400).json({ success: false, message: "User must have a company context" });
    }

    const allowedFields = [
      "category",
      "property",
      "landlord",
      "amount",
      "dueDate",
      "paidDate",
      "reference",
      "narration",
    ];
    const payload = Object.fromEntries(
      Object.entries(req.body || {}).filter(([key]) => allowedFields.includes(key))
    );

    const updated = await PaymentVoucher.findOneAndUpdate(
      { _id: req.params.id, business },
      { $set: payload },
      { new: true }
    )
      .populate("property", "propertyName name")
      .populate("landlord", "name landlordName");

    if (!updated) return res.status(404).json({ message: "Payment voucher not found" });

    emitToCompany(updated.business, "voucher:updated", { voucherId: updated._id });
    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
};

export const updatePaymentVoucherStatus = async (req, res, next) => {
  try {
    const business = req.user.company;
    if (!business) {
      return res.status(400).json({ success: false, message: "User must have a company context" });
    }

    const { status, reason } = req.body || {};
    if (!["draft", "approved", "paid", "reversed"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const userId = req.user?._id || req.user?.id || null;
    const patch = { status };

    if (status === "approved") {
      patch.approvedAt = new Date();
      patch.approvedBy = userId;
    }
    if (status === "paid") {
      patch.paidAt = new Date();
      patch.paidBy = userId;
      patch.paidDate = new Date();
    }
    if (status === "reversed") {
      patch.reversedAt = new Date();
      patch.reversedBy = userId;
      patch.reversalReason = reason || "Voucher reversed";
    }

    const updated = await PaymentVoucher.findOneAndUpdate(
      { _id: req.params.id, business },
      { $set: patch },
      { new: true }
    )
      .populate("property", "propertyName name")
      .populate("landlord", "name landlordName");

    if (!updated) return res.status(404).json({ message: "Payment voucher not found" });

    emitToCompany(updated.business, "voucher:status", { voucherId: updated._id, status });
    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
};

export const deletePaymentVoucher = async (req, res, next) => {
  try {
    const business = req.user.company;
    if (!business) {
      return res.status(400).json({ success: false, message: "User must have a company context" });
    }

    const row = await PaymentVoucher.findOne({ _id: req.params.id, business });
    if (!row) return res.status(404).json({ message: "Payment voucher not found" });

    await PaymentVoucher.findOneAndDelete({ _id: req.params.id, business });
    emitToCompany(row.business, "voucher:deleted", { voucherId: row._id });

    res.status(200).json({ success: true, message: "Payment voucher deleted" });
  } catch (err) {
    next(err);
  }
};
