const TenantInvoice = require('../../models/TenantInvoice');
const FinancialLedgerEntry = require('../../models/FinancialLedgerEntry');

exports.createTenantInvoice = async (req, res) => {
  try {
    const {
      business,
      property,
      landlord,
      tenant,
      unit,
      invoiceNumber,
      category,
      amount,
      description,
      invoiceDate,
      dueDate,
      createdBy
    } = req.body;

    // Amount validation
    if (amount <= 0) {
      return res.status(400).json({ error: 'Amount must be positive.' });
    }

    // Due date validation
    if (new Date(dueDate) < new Date(invoiceDate)) {
      return res.status(400).json({ error: 'Due date must be after invoice date.' });
    }

    const invoice = await TenantInvoice.create({
      business,
      property,
      landlord,
      tenant,
      unit,
      invoiceNumber,
      category,
      amount,
      description,
      invoiceDate,
      dueDate,
      status: 'pending',
      createdBy
    });

    await FinancialLedgerEntry.create({
      business,
      property,
      landlord,
      tenant,
      unit,
      category: category === 'UTILITY_CHARGE' ? 'UTILITY_CHARGE' : 'RENT_CHARGE',
      direction: 'debit',
      amount: invoice.amount,
      payer: 'tenant',
      receiver: 'manager',
      sourceTransactionType: 'invoice',
      sourceTransactionId: invoice._id,
      createdAt: new Date()
    });

    res.status(201).json(invoice);
  } catch (error) {
    // Handle duplicate invoice number error
    if (error.code === 11000 && error.keyPattern && error.keyPattern.invoiceNumber) {
      console.error('Duplicate invoice number:', error);
      return res.status(409).json({ error: 'Invoice number already exists. Please use a unique number.' });
    }
    console.error('TenantInvoice creation error:', error);
    res.status(500).json({ error: 'Failed to create invoice. ' + error.message });
  }
};