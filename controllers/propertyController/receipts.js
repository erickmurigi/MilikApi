import RentPayment from "../../models/RentPayment.js";
import ledgerPostingService from "../../services/ledgerPostingService.js";

export async function createReceipt(req, res) {
  try {
    const receipt = await RentPayment.create({
      ...req.body,
      ledgerType: "receipts",
      status: "completed",
    });

    await ledgerPostingService.postEntry({
      business: receipt.business,
      property: receipt.property,
      landlord: receipt.landlord,
      tenant: receipt.tenant,
      unit: receipt.unit,
      category: "RENT_PAYMENT",
      direction: "credit",
      amount: receipt.amount,
      payer: "tenant",
      receiver: "manager",
      sourceTransactionType: "receipt",
      sourceTransactionId: receipt._id,
      transactionDate: receipt.date,
      statementPeriodStart: receipt.statementPeriodStart,
      statementPeriodEnd: receipt.statementPeriodEnd,
      status: "approved",
      createdBy: req.user._id,
      approvedBy: req.user._id,
      approvedAt: new Date(),
    });

    res.status(201).json(receipt);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}