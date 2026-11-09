import { Pdf, dmy, type Col, type PdfCompany } from "./engine";
import type { SystemSettings, QuoteLine } from "@/lib/types";
import type { quoteDocument } from "../quotations";
import type { loadInvoiceDetail } from "../invoice-detail";

/** Company block for the letterhead, from Settings (+ COMPANY_WEBSITE, default the brand domain). */
export function pdfCompany(s: SystemSettings, opts: { gstin?: string } = {}): PdfCompany {
  return {
    name: s.companyName || "Intense Care",
    tagline: s.companyTagline,
    address: s.companyAddress,
    phone: s.companyPhone,
    email: s.companyEmail,
    website: process.env.COMPANY_WEBSITE?.trim() || "intensecare.in",
    gstin: opts.gstin,
    logo: s.logoDataUrl,
    signature: s.signatureDataUrl,
    signatoryName: s.signatoryName,
  };
}

const num = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);

function lineRows(p: Pdf, items: QuoteLine[], gst: boolean, gstRate: number) {
  const cols: Col[] = [
    { key: "n", title: "#", w: 4, align: "center" },
    { key: "desc", title: "Service description", w: gst ? 40 : 46 },
    { key: "qty", title: "Qty", w: 8, align: "right" },
    { key: "rate", title: "Unit price", w: 15, align: "right" },
    ...(gst ? [{ key: "gst", title: "GST", w: 7, align: "right" } as Col] : []),
    { key: "amt", title: "Line total", w: 16, align: "right" },
  ];
  const rows = items.map((l, i) => ({ n: String(i + 1), desc: l.description, qty: num(l.quantity), rate: p.money(l.rate), gst: `${gstRate}%`, amt: p.money(l.amount) }));
  p.table(cols, rows);
}

/* ------------------------------------------------------------------------------------------------ quotation */

export async function buildQuotePdf(d: Awaited<ReturnType<typeof quoteDocument>>, settings: SystemSettings): Promise<Buffer> {
  const { q, customer, company } = d;
  const gst = q.quoteType !== "NON_GST";
  const p = new Pdf(pdfCompany(settings, { gstin: gst ? settings.gstin?.trim() : "" }), { title: `Quotation ${q.quoteNumber}`, subject: `Quotation for ${customer.name}` });
  p.firstPageHeader("QUOTATION", [
    { label: "Quotation no.", value: q.quoteNumber },
    { label: "Issue date", value: dmy(q.createdAt) },
    { label: "Valid until", value: dmy(q.validUntil) },
  ]);

  const items = (Array.isArray(q.items) ? q.items : []) as unknown as QuoteLine[];
  const taxable = Math.round((q.subtotal - q.discount) * 100) / 100;
  p.twoColumn(
    {
      heading: "Prepared for",
      lines: [
        { text: customer.name, bold: true },
        ...(customer.phone ? [{ text: customer.phone }] : []),
        ...(customer.email ? [{ text: customer.email }] : []),
        ...(gst && q.customerGstin ? [{ text: `GSTIN: ${q.customerGstin}` }] : []),
      ],
    },
    d.serviceAddress ? { heading: "Service address", lines: [{ text: d.serviceAddress }] } : customer.address ? { heading: "Address", lines: [{ text: customer.address }] } : null
  );

  lineRows(p, items, gst, q.gstRate);

  const rows: { label: string; value: string; strong?: boolean; muted?: boolean }[] = [{ label: "Subtotal", value: p.money(q.subtotal) }];
  if (q.discount > 0) rows.push({ label: "Discount", value: `− ${p.money(q.discount)}` }, { label: "Taxable amount", value: p.money(taxable) });
  if (gst) {
    if (q.interState) rows.push({ label: `IGST @ ${q.gstRate}%`, value: p.money(q.igst) });
    else rows.push({ label: `CGST @ ${q.gstRate / 2}%`, value: p.money(q.cgst) }, { label: `SGST @ ${q.gstRate / 2}%`, value: p.money(q.sgst) });
  }
  rows.push({ label: "Grand total", value: p.money(q.total), strong: true });
  if (q.advanceAmount && q.advanceAmount > 0) {
    rows.push({ label: "Advance requested", value: p.money(q.advanceAmount) }, { label: "Balance after advance", value: p.money(Math.max(0, q.total - q.advanceAmount)) });
  }
  p.summary(rows, { note: gst ? "All amounts in INR (₹). GST charged as shown." : "All amounts in INR (₹). No GST is charged on this quotation." });
  p.amountWords(q.total);

  p.section("Service scope", items.map((l) => `${l.description}${l.quantity !== 1 ? ` × ${num(l.quantity)}` : ""}`).join("\n"), { bullets: true });
  p.section("Additional requirements", q.requirements);
  p.section("Notes", q.notes);
  p.section("Payment terms", q.paymentTerms);
  p.section("Terms & conditions", q.terms, { size: 8.5 });
  p.section("Validity", `This quotation is valid until ${dmy(q.validUntil)}. Prices and availability are confirmed on acceptance.`);
  p.signatures({ acceptance: true, company: pdfCompany(settings), ack: "I have read and accept this quotation and its terms." });
  return p.finish(`Quotation ${q.quoteNumber}${gst ? "" : " · Non-GST"}`);
}

/* ------------------------------------------------------------------------------------------------ invoice */

const STATUS_LABEL: Record<string, { text: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  PAID: { text: "PAID", tone: "good" },
  PARTIAL: { text: "PARTIALLY PAID", tone: "warn" },
  UNPAID: { text: "UNPAID", tone: "bad" },
  REFUNDED: { text: "REFUNDED", tone: "neutral" },
  CANCELLED: { text: "CANCELLED", tone: "neutral" },
  VOID: { text: "VOID", tone: "neutral" },
};

export async function buildInvoicePdf(d: Awaited<ReturnType<typeof loadInvoiceDetail>>, settings: SystemSettings): Promise<Buffer> {
  const { invoice: inv, customer, job } = d;
  const gst = inv.invoiceType === "GST";
  const supplierGstin = gst ? inv.supplierGstin || settings.gstin?.trim() || "" : "";
  const p = new Pdf(pdfCompany(settings, { gstin: supplierGstin }), { title: `${gst ? "Tax invoice" : "Invoice"} ${inv.invoiceNumber}`, subject: `Invoice for ${customer.name}` });
  p.firstPageHeader(gst ? "TAX INVOICE" : "INVOICE", [
    { label: "Invoice no.", value: inv.invoiceNumber },
    { label: "Invoice date", value: dmy(inv.issuedAt) },
    { label: "Due date", value: dmy(inv.dueDate) },
    { label: "Job ID", value: job.jobNumber && job.jobNumber !== "—" ? job.jobNumber : "" },
    { label: "Quotation ref.", value: d.quoteNumber ?? "" },
    { label: "Service date", value: job.serviceDate && job.serviceDate !== "—" ? dmy(job.serviceDate) : "" },
  ]);
  // status badge — taken straight from the invoice's recorded status (payments are confirmed elsewhere, never here)
  const st = STATUS_LABEL[inv.status] ?? { text: String(inv.status), tone: "neutral" as const };
  p.badge(st.text, 42, p.y - 6, st.tone);
  p.y += 20;

  const clean = (s?: string) => (s && s !== "—" ? s : "");
  p.twoColumn(
    {
      heading: "Bill to",
      lines: [
        { text: customer.name, bold: true },
        ...(clean(customer.address) ? [{ text: clean(customer.address) }] : []),
        ...(customer.phone ? [{ text: customer.phone }] : []),
        ...(customer.email ? [{ text: customer.email }] : []),
        ...(gst ? [{ text: `GSTIN: ${customer.gstin || "Unregistered"}` }] : []),
      ],
    },
    clean(customer.serviceAddress) ? { heading: "Service address", lines: [{ text: clean(customer.serviceAddress) }, ...(gst ? [{ text: `Supply: ${inv.interState ? "Inter-state (IGST)" : "Intra-state (CGST + SGST)"}` }] : [])] } : null
  );

  const items: QuoteLine[] = inv.items?.length ? inv.items : [{ description: job.serviceName, quantity: 1, rate: inv.subtotal, amount: inv.subtotal, custom: false }];
  lineRows(p, items, gst, inv.gstRate);

  const taxable = Math.round((inv.subtotal - inv.discount) * 100) / 100;
  const rows: { label: string; value: string; strong?: boolean; muted?: boolean }[] = [{ label: "Subtotal", value: p.money(inv.subtotal) }];
  if (inv.discount > 0) rows.push({ label: "Discount", value: `− ${p.money(inv.discount)}` });
  rows.push({ label: gst ? "Taxable value" : "Amount", value: p.money(taxable) });
  if (gst) {
    if (inv.interState) rows.push({ label: `IGST @ ${inv.gstRate}%`, value: p.money(inv.igst) });
    else rows.push({ label: `CGST @ ${inv.gstRate / 2}%`, value: p.money(inv.cgst) }, { label: `SGST @ ${inv.gstRate / 2}%`, value: p.money(inv.sgst) });
  }
  rows.push({ label: "Invoice total", value: p.money(inv.total), strong: true });
  rows.push({ label: "Amount paid", value: p.money(inv.amountPaid) }, { label: "Balance due", value: p.money(inv.balanceDue) });
  p.summary(rows, { note: gst ? `All amounts in INR (₹). SAC ${settings.sacCode || "—"}.` : "All amounts in INR (₹). No GST is charged on this invoice." });
  p.amountWords(inv.total);

  if (d.upi && inv.balanceDue > 0 && !["CANCELLED", "VOID", "REFUNDED"].includes(inv.status)) {
    p.section("Pay by UPI", `UPI ID: ${d.upi.vpa}${d.upi.payeeName ? `  ·  Payee: ${d.upi.payeeName}` : ""}\nPlease quote ${inv.invoiceNumber} as the payment reference. A payment is shown as received only after it is confirmed by ${settings.companyName || "Intense Care"}.`);
  }
  p.section("Payment terms", inv.paymentTerms);
  p.section("Notes", inv.notes);
  p.signatures({ acceptance: false, company: pdfCompany(settings) });
  return p.finish(gst ? "This is a computer-generated tax invoice." : "This is a computer-generated invoice. No GST is charged.");
}
