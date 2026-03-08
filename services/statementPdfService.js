/**
 * statementPdfService.js
 * 
 * PDF generation service for landlord statements.
 * 
 * CRITICAL RULE: This service generates PDFs ONLY from immutable statement snapshots.
 * It NEVER recomputes values from the ledger.
 * 
 * Data sources:
 * - LandlordStatement (header with totals)
 * - LandlordStatementLine (frozen transaction lines)
 * 
 * This ensures the PDF exactly matches the approved/sent snapshot.
 * 
 * PERFORMANCE OPTIMIZATION:
 * - Uses a single reusable Puppeteer browser instance
 * - Each PDF generation creates a new page from the shared browser
 * - Pages are closed after rendering, but the browser persists
 * - Reduces Chrome process overhead and improves throughput
 */

import puppeteer from "puppeteer";
import LandlordStatement from "../models/LandlordStatement.js";
import LandlordStatementLine from "../models/LandlordStatementLine.js";

/**
 * Global browser instance
 * Initialized on first use and reused for all subsequent PDF generations
 */
let globalBrowser = null;

/**
 * Initialization flag to prevent race conditions during browser startup
 */
let browserInitializing = false;

/**
 * Generate a PDF for a landlord statement.
 * 
 * @param {string} statementId - The statement ID
 * @param {string} businessId - The business ID (for isolation)
 * @returns {Promise<Buffer>} PDF buffer
 */
export const generateStatementPdf = async (statementId, businessId) => {
  try {
    // 1. Fetch LandlordStatement with business isolation
    const statement = await LandlordStatement.findOne({
      _id: statementId,
      business: businessId,
    })
      .populate("property", "name address city postalCode")
      .populate("landlord", "firstName lastName email phone")
      .populate("business", "companyName email phone address")
      .lean();

    if (!statement) {
      throw new Error("Statement not found or access denied");
    }

    // Only approved or sent statements can be converted to PDF
    if (statement.status !== "approved" && statement.status !== "sent") {
      throw new Error(`Cannot generate PDF for statement with status: ${statement.status}. Only approved or sent statements can be printed.`);
    }

    // 2. Fetch LandlordStatementLine sorted by lineNumber ASC
    const lines = await LandlordStatementLine.find({
      statement: statementId,
      business: businessId,
    })
      .sort({ lineNumber: 1 })
      .lean();

    // 3. Build HTML template
    const html = buildStatementHtml(statement, lines);

    // 4. Convert HTML to PDF using puppeteer
    const pdfBuffer = await convertHtmlToPdf(html);

    return pdfBuffer;
  } catch (error) {
    console.error("Error generating statement PDF:", error);
    throw error;
  }
};

/**
 * Build HTML template for landlord statement.
 * 
 * @param {Object} statement - LandlordStatement document
 * @param {Array} lines - Array of LandlordStatementLine documents
 * @returns {string} HTML string
 */
const buildStatementHtml = (statement, lines) => {
  const propertyName = statement.property?.name || "N/A";
  const propertyAddress = formatPropertyAddress(statement.property);
  const landlordName = formatLandlordName(statement.landlord);
  const landlordContact = formatLandlordContact(statement.landlord);
  const companyName = statement.business?.companyName || "Property Management";
  const companyContact = formatCompanyContact(statement.business);

  const statementNumber = statement.statementNumber || "N/A";
  const periodStart = formatDate(statement.periodStart);
  const periodEnd = formatDate(statement.periodEnd);
  const currency = statement.currency || "KES";
  const version = statement.version > 1 ? `v${statement.version}` : "";

  const openingBalance = formatCurrency(statement.openingBalance, currency);
  const periodNet = formatCurrency(statement.periodNet, currency);
  const closingBalance = formatCurrency(statement.closingBalance, currency);

  const transactionRows = lines.map((line) => {
    const date = formatDate(line.transactionDate);
    const description = escapeHtml(line.description || "");
    const category = escapeHtml(line.category || "");
    const debit = line.direction === "debit" ? formatCurrency(line.amount, currency) : "";
    const credit = line.direction === "credit" ? formatCurrency(line.amount, currency) : "";
    const runningBalance = formatCurrency(line.runningBalance, currency);

    return `
      <tr>
        <td>${date}</td>
        <td>${description}</td>
        <td>${category}</td>
        <td class="amount">${debit}</td>
        <td class="amount">${credit}</td>
        <td class="amount">${runningBalance}</td>
      </tr>
    `;
  }).join("");

  const statusBadge = getStatusBadge(statement.status);
  const approvedInfo = statement.approvedAt 
    ? `<p><strong>Approved:</strong> ${formatDateTime(statement.approvedAt)}</p>` 
    : "";
  const sentInfo = statement.sentAt 
    ? `<p><strong>Sent:</strong> ${formatDateTime(statement.sentAt)}</p>` 
    : "";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Landlord Statement - ${statementNumber}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 10pt;
      color: #333;
      padding: 20px;
    }
    
    .header {
      border-bottom: 3px solid #2c3e50;
      padding-bottom: 15px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
    }
    
    .company-info {
      flex: 1;
    }
    
    .company-info h1 {
      font-size: 18pt;
      color: #2c3e50;
      margin-bottom: 5px;
    }
    
    .company-info p {
      font-size: 9pt;
      color: #666;
      line-height: 1.4;
    }
    
    .statement-info {
      text-align: right;
      flex: 1;
    }
    
    .statement-info h2 {
      font-size: 14pt;
      color: #2c3e50;
      margin-bottom: 8px;
    }
    
    .statement-info p {
      font-size: 9pt;
      margin: 3px 0;
    }
    
    .status-badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 8pt;
      font-weight: bold;
      text-transform: uppercase;
      margin-top: 5px;
    }
    
    .status-approved {
      background-color: #27ae60;
      color: white;
    }
    
    .status-sent {
      background-color: #3498db;
      color: white;
    }
    
    .parties {
      display: flex;
      justify-content: space-between;
      margin-bottom: 25px;
      gap: 20px;
    }
    
    .party-box {
      flex: 1;
      background-color: #f8f9fa;
      padding: 15px;
      border-radius: 5px;
      border-left: 4px solid #2c3e50;
    }
    
    .party-box h3 {
      font-size: 11pt;
      color: #2c3e50;
      margin-bottom: 8px;
      border-bottom: 1px solid #ddd;
      padding-bottom: 5px;
    }
    
    .party-box p {
      font-size: 9pt;
      line-height: 1.5;
      margin: 3px 0;
    }
    
    .summary {
      background-color: #ecf0f1;
      padding: 15px;
      margin-bottom: 25px;
      border-radius: 5px;
    }
    
    .summary h3 {
      font-size: 12pt;
      color: #2c3e50;
      margin-bottom: 10px;
    }
    
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
    }
    
    .summary-item {
      text-align: center;
    }
    
    .summary-label {
      font-size: 9pt;
      color: #666;
      margin-bottom: 5px;
    }
    
    .summary-value {
      font-size: 14pt;
      font-weight: bold;
      color: #2c3e50;
    }
    
    .transactions {
      margin-bottom: 20px;
    }
    
    .transactions h3 {
      font-size: 12pt;
      color: #2c3e50;
      margin-bottom: 10px;
      border-bottom: 2px solid #2c3e50;
      padding-bottom: 5px;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    
    th {
      background-color: #34495e;
      color: white;
      padding: 10px 8px;
      text-align: left;
      font-size: 9pt;
      font-weight: 600;
      border: 1px solid #2c3e50;
    }
    
    td {
      padding: 8px;
      border: 1px solid #ddd;
      font-size: 9pt;
    }
    
    tr:nth-child(even) {
      background-color: #f8f9fa;
    }
    
    .amount {
      text-align: right;
      font-family: 'Courier New', monospace;
    }
    
    .footer {
      margin-top: 30px;
      padding-top: 15px;
      border-top: 2px solid #95a5a6;
      font-size: 8pt;
      color: #7f8c8d;
      text-align: center;
    }
    
    .audit-info {
      margin-top: 20px;
      padding: 10px;
      background-color: #f8f9fa;
      border-left: 4px solid #95a5a6;
      font-size: 8pt;
      color: #666;
    }
    
    @media print {
      body {
        padding: 0;
      }
      
      .party-box {
        page-break-inside: avoid;
      }
      
      table {
        page-break-inside: auto;
      }
      
      tr {
        page-break-inside: avoid;
        page-break-after: auto;
      }
      
      thead {
        display: table-header-group;
      }
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <div class="company-info">
      <h1>${escapeHtml(companyName)}</h1>
      ${companyContact}
    </div>
    <div class="statement-info">
      <h2>LANDLORD STATEMENT ${version}</h2>
      <p><strong>Statement #:</strong> ${escapeHtml(statementNumber)}</p>
      <p><strong>Period:</strong> ${periodStart} - ${periodEnd}</p>
      <p><strong>Currency:</strong> ${currency}</p>
      ${statusBadge}
    </div>
  </div>
  
  <!-- Parties -->
  <div class="parties">
    <div class="party-box">
      <h3>Property</h3>
      <p><strong>${escapeHtml(propertyName)}</strong></p>
      ${propertyAddress}
    </div>
    <div class="party-box">
      <h3>Landlord</h3>
      <p><strong>${escapeHtml(landlordName)}</strong></p>
      ${landlordContact}
    </div>
  </div>
  
  <!-- Summary -->
  <div class="summary">
    <h3>Statement Summary</h3>
    <div class="summary-grid">
      <div class="summary-item">
        <div class="summary-label">Opening Balance</div>
        <div class="summary-value">${openingBalance}</div>
      </div>
      <div class="summary-item">
        <div class="summary-label">Period Net</div>
        <div class="summary-value">${periodNet}</div>
      </div>
      <div class="summary-item">
        <div class="summary-label">Closing Balance</div>
        <div class="summary-value">${closingBalance}</div>
      </div>
    </div>
  </div>
  
  <!-- Transactions -->
  <div class="transactions">
    <h3>Transactions</h3>
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Description</th>
          <th>Category</th>
          <th>Debit</th>
          <th>Credit</th>
          <th>Balance</th>
        </tr>
      </thead>
      <tbody>
        ${transactionRows || '<tr><td colspan="6" style="text-align:center;">No transactions in this period</td></tr>'}
      </tbody>
    </table>
  </div>
  
  <!-- Audit Info -->
  <div class="audit-info">
    <p><strong>Statement ID:</strong> ${statement._id}</p>
    <p><strong>Version:</strong> ${statement.version}</p>
    <p><strong>Line Count:</strong> ${statement.lineCount || 0}</p>
    <p><strong>Ledger Entries:</strong> ${statement.ledgerEntryCount || 0}</p>
    ${approvedInfo}
    ${sentInfo}
  </div>
  
  <!-- Footer -->
  <div class="footer">
    <p>This statement is an immutable snapshot. All amounts are in ${currency}.</p>
    <p>Generated on ${formatDateTime(new Date())}</p>
  </div>
</body>
</html>
  `;
};

/**
 * Convert HTML to PDF using puppeteer.
 * Uses a reusable browser instance for performance.
 * 
 * @param {string} html - HTML string
 * @returns {Promise<Buffer>} PDF buffer
 */
const convertHtmlToPdf = async (html) => {
  let page = null;

  try {
    // Get the shared browser instance
    const browser = await getBrowser();

    // Create a new page for this PDF
    page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    // Generate PDF from the page
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20px',
        right: '20px',
        bottom: '20px',
        left: '20px',
      },
    });

    return pdfBuffer;
  } catch (error) {
    console.error("Error converting HTML to PDF:", error);
    throw new Error("Failed to generate PDF");
  } finally {
    // Close the page but keep the browser alive
    if (page) {
      try {
        await page.close();
      } catch (err) {
        console.error("Error closing page:", err);
      }
    }
  }
};

/**
 * Get or initialize the Puppeteer browser instance.
 * Implements lazy initialization with race condition protection.
 * 
 * @returns {Promise<Browser>} Puppeteer browser instance
 */
const getBrowser = async () => {
  // Return existing browser if already initialized
  if (globalBrowser) {
    return globalBrowser;
  }

  // Prevent multiple concurrent initialization attempts
  if (browserInitializing) {
    // Wait for initialization to complete
    let attempts = 0;
    while (browserInitializing && attempts < 100) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      attempts++;
    }
    if (globalBrowser) {
      return globalBrowser;
    }
  }

  try {
    browserInitializing = true;

    console.log("Initializing Puppeteer browser instance...");

    // Launch browser with headless mode and sandbox disabled for compatibility
    globalBrowser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // Use temp space instead of /dev/shm
      ],
    });

    console.log("Puppeteer browser instance initialized");

    return globalBrowser;
  } catch (error) {
    console.error("Error initializing Puppeteer browser:", error);
    globalBrowser = null;
    throw new Error("Failed to initialize PDF generation service");
  } finally {
    browserInitializing = false;
  }
};

/**
 * Close the global browser instance gracefully.
 * Call this on application shutdown.
 */
const closeBrowser = async () => {
  if (globalBrowser) {
    try {
      console.log("Closing Puppeteer browser instance...");
      await globalBrowser.close();
      globalBrowser = null;
      console.log("Puppeteer browser closed successfully");
    } catch (error) {
      console.error("Error closing Puppeteer browser:", error);
    }
  }
};

/**
 * Register process shutdown handlers for graceful browser cleanup.
 * Ensures Chrome processes are properly terminated on exit.
 */
const registerShutdownHandlers = () => {
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];

  signals.forEach((signal) => {
    process.on(signal, async () => {
      console.log(`\nReceived ${signal}, closing resources...`);
      await closeBrowser();
      process.exit(0);
    });
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
    console.error('Uncaught exception:', error);
    await closeBrowser();
    process.exit(1);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', async (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    await closeBrowser();
    process.exit(1);
  });
};

// Register shutdown handlers when service is imported
registerShutdownHandlers();

/**
 * Helper functions for formatting
 */

const formatDate = (date) => {
  if (!date) return "N/A";
  const d = new Date(date);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatDateTime = (date) => {
  if (!date) return "N/A";
  const d = new Date(date);
  return d.toLocaleString('en-GB', { 
    day: '2-digit', 
    month: 'short', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const formatCurrency = (amount, currency = "KES") => {
  if (amount === null || amount === undefined) return "-";
  const formatted = Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = amount < 0 ? '-' : '';
  return `${sign}${currency} ${formatted}`;
};

const formatLandlordName = (landlord) => {
  if (!landlord) return "N/A";
  return `${landlord.firstName || ""} ${landlord.lastName || ""}`.trim() || "N/A";
};

const formatLandlordContact = (landlord) => {
  if (!landlord) return "<p>N/A</p>";
  const parts = [];
  if (landlord.email) parts.push(`<p>Email: ${escapeHtml(landlord.email)}</p>`);
  if (landlord.phone) parts.push(`<p>Phone: ${escapeHtml(landlord.phone)}</p>`);
  return parts.length > 0 ? parts.join("") : "<p>No contact information</p>";
};

const formatPropertyAddress = (property) => {
  if (!property) return "<p>N/A</p>";
  const parts = [];
  if (property.address) parts.push(property.address);
  if (property.city) parts.push(property.city);
  if (property.postalCode) parts.push(property.postalCode);
  const addressStr = parts.join(", ");
  return addressStr ? `<p>${escapeHtml(addressStr)}</p>` : "<p>No address available</p>";
};

const formatCompanyContact = (business) => {
  if (!business) return "<p>N/A</p>";
  const parts = [];
  if (business.email) parts.push(`<p>Email: ${escapeHtml(business.email)}</p>`);
  if (business.phone) parts.push(`<p>Phone: ${escapeHtml(business.phone)}</p>`);
  if (business.address) parts.push(`<p>${escapeHtml(business.address)}</p>`);
  return parts.length > 0 ? parts.join("") : "<p>No contact information</p>";
};

const escapeHtml = (text) => {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

const getStatusBadge = (status) => {
  const statusMap = {
    approved: '<span class="status-badge status-approved">Approved</span>',
    sent: '<span class="status-badge status-sent">Sent</span>',
  };
  return statusMap[status] || '';
};

export default {
  generateStatementPdf,
  closeBrowser,
  getBrowser,
};
