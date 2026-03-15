import puppeteer from "puppeteer";
import LandlordStatement from "../models/LandlordStatement.js";
import LandlordStatementLine from "../models/LandlordStatementLine.js";

let globalBrowser = null;
let browserInitializing = false;

const formatCurrency = (value) => new Intl.NumberFormat("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));
const formatDate = (value) => value ? new Date(value).toLocaleDateString("en-GB") : "";
const esc = (value = "") => String(value || "").replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

const buildRowsFromLines = (lines = []) => {
  const map = new Map();
  const getRow = (line) => {
    const tenant = line.tenant || {};
    const unit = line.unit || {};
    const key = `${unit._id || line.unit || ''}:${tenant._id || line.tenant || ''}`;
    if (!map.has(key)) {
      map.set(key, {
        unit: unit.unitNumber || unit.name || line?.metadata?.unit || "-",
        accountNo: tenant.tenantCode || line?.metadata?.tenantCode || "-",
        tenantName: tenant.name || line?.metadata?.tenantName || "VACANT",
        perMonth: Number(line?.metadata?.perMonth || 0),
        balanceBF: 0,
        invoicedRent: 0,
        invoicedGarbage: 0,
        invoicedWater: 0,
        paidRent: 0,
        paidGarbage: 0,
        paidWater: 0,
        balanceCF: 0,
      });
    }
    return map.get(key);
  };
  for (const line of lines) {
    const row = getRow(line);
    const amt = Number(line.amount || 0);
    const cat = String(line.category || "").toUpperCase();
    if (cat === "RENT_CHARGE") row.invoicedRent += amt;
    else if (cat === "UTILITY_CHARGE") {
      const hint = `${line.description || ''} ${line.metadata?.expenseCategory || ''}`.toLowerCase();
      if (/water/.test(hint)) row.invoicedWater += amt;
      else row.invoicedGarbage += amt;
    } else if (cat === "RENT_RECEIPT_MANAGER" || cat === "RENT_RECEIPT_LANDLORD") row.paidRent += amt;
    else if (cat === "UTILITY_RECEIPT_MANAGER" || cat === "UTILITY_RECEIPT_LANDLORD") {
      const hint = `${line.description || ''}`.toLowerCase();
      if (/water/.test(hint)) row.paidWater += amt;
      else row.paidGarbage += amt;
    }
  }
  return Array.from(map.values()).map((r) => ({ ...r, balanceCF: r.balanceBF + r.invoicedRent + r.invoicedGarbage + r.invoicedWater - r.paidRent - r.paidGarbage - r.paidWater }));
};

async function getBrowser() {
  if (globalBrowser) return globalBrowser;
  if (browserInitializing) {
    while (!globalBrowser) await new Promise((r) => setTimeout(r, 100));
    return globalBrowser;
  }
  browserInitializing = true;
  globalBrowser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  browserInitializing = false;
  return globalBrowser;
}

export const generateStatementPdf = async (statementId, businessId) => {
  const statement = await LandlordStatement.findOne({ _id: statementId, business: businessId })
    .populate("property", "propertyCode propertyName name address city commissionPercentage commissionRecognitionBasis totalUnits")
    .populate("landlord", "firstName lastName landlordName email phone phoneNumber")
    .populate("business", "companyName name address phone email")
    .lean();

  if (!statement) throw new Error("Statement not found or access denied");

  const lines = await LandlordStatementLine.find({ statement: statementId, business: businessId })
    .populate("tenant", "name tenantCode")
    .populate("unit", "unitNumber name")
    .sort({ lineNumber: 1 })
    .lean();

  const workspace = statement.metadata?.workspace || {};
  const tenantRows = Array.isArray(workspace.tenantRows) && workspace.tenantRows.length > 0
    ? workspace.tenantRows
    : buildRowsFromLines(lines);
  const expenseRows = [
    ...(Array.isArray(workspace.expenses) ? workspace.expenses : []),
    ...(Array.isArray(workspace.directLandlordReceipts) ? workspace.directLandlordReceipts : []),
  ];
  const summary = workspace.summary || {};

  const companyName = statement.business?.companyName || statement.business?.name || "MILIK SYSTEM";
  const companyAddress = statement.business?.address || "";
  const companyPhone = statement.business?.phone || "";
  const companyEmail = statement.business?.email || "";
  const landlordName = [statement.landlord?.firstName, statement.landlord?.lastName].filter(Boolean).join(" ") || statement.landlord?.landlordName || "Landlord";
  const propertyName = statement.property?.propertyName || statement.property?.name || "Property";
  const propertyCode = statement.property?.propertyCode || "";

  const totals = {
    perMonth: tenantRows.reduce((s, r) => s + Number(r.perMonth || 0), 0),
    bf: tenantRows.reduce((s, r) => s + Number(r.balanceBF || 0), 0),
    invRent: tenantRows.reduce((s, r) => s + Number(r.invoicedRent || 0), 0),
    invGarbage: tenantRows.reduce((s, r) => s + Number(r.invoicedGarbage || 0), 0),
    invWater: tenantRows.reduce((s, r) => s + Number(r.invoicedWater || 0), 0),
    paidRent: tenantRows.reduce((s, r) => s + Number(r.paidRent || 0), 0),
    paidGarbage: tenantRows.reduce((s, r) => s + Number(r.paidGarbage || 0), 0),
    paidWater: tenantRows.reduce((s, r) => s + Number(r.paidWater || 0), 0),
    cf: tenantRows.reduce((s, r) => s + Number(r.balanceCF || 0), 0),
  };

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8" />
<style>
body{font-family:Arial,sans-serif;font-size:10px;color:#111;margin:0;padding:12px}
.header{text-align:center;border-bottom:2px solid #0B3B2E;padding-bottom:8px;margin-bottom:10px}
.header h1{margin:0;font-size:18px}.meta{font-size:11px;line-height:1.4}.title{text-align:center;font-weight:700;text-decoration:underline;margin:10px 0 8px}
.top{display:flex;justify-content:space-between;margin:6px 0 10px}.top .left div,.top .right div{margin:2px 0}
table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #555;padding:3px 4px}th{background:#eef2f7}.group{background:#dfe8f2;font-weight:700;text-align:center}.right{text-align:right}.center{text-align:center}.totals td{font-weight:700;background:#f5f7fa}.section{margin-top:14px}.summarybox{margin-top:14px;display:flex;justify-content:flex-end}.summarybox table{width:320px}
</style></head><body>
<div class="header"><h1>${esc(companyName)}</h1><div class="meta">${esc(companyAddress)}<br/>TEL: ${esc(companyPhone)}<br/>EMAIL: ${esc(companyEmail)}</div></div>
<div class="title">PROPERTY ACCOUNT STATEMENT - ${String(statement.notes || '').toLowerCase().includes('final') ? 'FINAL' : 'PROVISIONAL'}</div>
<div class="top"><div class="left"><div><strong>LANDLORD</strong> ${esc(landlordName)}</div><div><strong>PROPERTY</strong> ${esc(`[${propertyCode}] ${propertyName}`)}</div></div><div class="right"><div><strong>STATEMENT PERIOD</strong> ${esc(new Date(statement.periodStart).toLocaleString('default',{month:'long'}))} - ${new Date(statement.periodStart).getFullYear()}</div><div><strong>${formatDate(statement.periodStart)} - ${formatDate(statement.periodEnd)}</strong></div></div></div>
<table>
<thead>
<tr><th rowspan="2">UNIT</th><th rowspan="2">A/C NO.</th><th rowspan="2">TENANT/RESIDENT</th><th rowspan="2">PER MONTH</th><th rowspan="2">BALANCE B/F<br/>TOTAL B/F</th><th class="group" colspan="3">AMOUNT INVOICED</th><th class="group" colspan="3">AMOUNT PAID</th><th rowspan="2">BALANCE C/F</th></tr>
<tr><th>RENT</th><th>GARBAGE</th><th>WATER</th><th>RENT</th><th>GARBAGE</th><th>WATER</th></tr>
</thead><tbody>
${tenantRows.map((r)=>`<tr><td>${esc(r.unit)}</td><td>${esc(r.accountNo)}</td><td>${esc(r.tenantName)}</td><td class="right">${formatCurrency(r.perMonth)}</td><td class="right">${formatCurrency(r.balanceBF)}</td><td class="right">${formatCurrency(r.invoicedRent)}</td><td class="right">${formatCurrency(r.invoicedGarbage)}</td><td class="right">${formatCurrency(r.invoicedWater)}</td><td class="right">${formatCurrency(r.paidRent)}</td><td class="right">${formatCurrency(r.paidGarbage)}</td><td class="right">${formatCurrency(r.paidWater)}</td><td class="right">${formatCurrency(r.balanceCF)}</td></tr>`).join('')}
<tr class="totals"><td colspan="3"></td><td class="right">${formatCurrency(totals.perMonth)}</td><td class="right">${formatCurrency(totals.bf)}</td><td class="right">${formatCurrency(totals.invRent)}</td><td class="right">${formatCurrency(totals.invGarbage)}</td><td class="right">${formatCurrency(totals.invWater)}</td><td class="right">${formatCurrency(totals.paidRent)}</td><td class="right">${formatCurrency(totals.paidGarbage)}</td><td class="right">${formatCurrency(totals.paidWater)}</td><td class="right">${formatCurrency(totals.cf)}</td></tr>
</tbody></table>
<div class="section"><div style="font-weight:700;margin-bottom:4px">EXPENSES & DEDUCTIONS</div><table><thead><tr><th>Date</th><th>Description</th><th class="right">Amount</th></tr></thead><tbody>${expenseRows.length?expenseRows.map((e)=>`<tr><td>${formatDate(e.date)}</td><td>${esc(e.description)}</td><td class="right">${formatCurrency(e.amount)}</td></tr>`).join(''):'<tr><td colspan="3" class="center">No expenses or deductions posted in this period</td></tr>'}<tr class="totals"><td colspan="2">TOTAL</td><td class="right">${formatCurrency(expenseRows.reduce((s,e)=>s+Number(e.amount||0),0))}</td></tr></tbody></table></div>
<div class="summarybox"><table><tbody><tr><th>MANAGER COLLECTIONS</th><td class="right">${formatCurrency(summary.managerCollections || 0)}</td></tr><tr><th>COMMISSION</th><td class="right">${formatCurrency(summary.commissionAmount || 0)}</td></tr><tr><th>TOTAL DEDUCTIONS</th><td class="right">${formatCurrency(summary.totalDeductions || 0)}</td></tr><tr><th>NET PAYABLE TO LANDLORD</th><td class="right">${formatCurrency(summary.netRemittance || 0)}</td></tr></tbody></table></div>
</body></html>`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "8mm", right: "8mm" } });
  await page.close();
  return pdf;
};
