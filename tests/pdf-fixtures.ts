import type { SystemSettings } from "../src/lib/types";

export const settingsFixture = {
  companyName: "Intense Care", companyTagline: "Deep Cleaning Field Services", companyAddress: "No. 14, 2nd Cross, Indiranagar, Bengaluru 560038", companyPhone: "+91 98450 12345", companyEmail: "hello@intensecare.in",
  gstin: "29ABCDE1234F1Z5", sacCode: "998533", taxRatePercent: 18, logoDataUrl: "", signatureDataUrl: "", signatoryName: "Authorised Signatory",
  upi: { enabled: true, vpa: "intensecare@okhdfcbank", payeeName: "Intense Care", description: "" },
} as unknown as SystemSettings;

export const line = (description: string, quantity: number, rate: number) => ({ serviceId: null, description, quantity, rate, amount: Math.round(quantity * rate * 100) / 100, custom: true });

export function quoteDoc(over: { items: ReturnType<typeof line>[]; gst?: boolean; address?: string | null; name?: string; discount?: number; advance?: number; terms?: string; requirements?: string; email?: string; phone?: string }) {
  const gst = over.gst !== false;
  const subtotal = over.items.reduce((a, l) => a + l.amount, 0);
  const discount = over.discount ?? 0;
  const taxable = subtotal - discount;
  const tax = gst ? Math.round(taxable * 18) / 100 : 0;
  return {
    q: {
      id: "q1", quoteNumber: "QT-2627-00042", customerId: "c1", propertyId: null, serviceId: null, items: over.items, quoteType: gst ? "GST" : "NON_GST", gstRate: gst ? 18 : 0, cgst: tax / 2, sgst: tax / 2, igst: 0, interState: false,
      customerGstin: gst ? "29AAAAA0000A1Z5" : null, subtotal, tax, discount, total: taxable + tax, validUntil: "2026-11-30", terms: over.terms ?? "Prices are valid until the date shown.\nWork is scheduled after acceptance.\nAny extra work is quoted separately.", paymentTerms: "50% advance, balance on completion.",
      notes: "Please keep the balcony accessible.", serviceAddress: over.address ?? null, requirements: over.requirements ?? null, internalNotes: "SECRET INTERNAL", advanceAmount: over.advance ?? null,
      status: "sent", acceptedAt: null, acceptedBy: null, shareTokenHash: null, shareTokenEnc: null, jobId: null, createdAt: new Date("2026-11-07T05:00:00Z"), updatedAt: new Date(),
    },
    customer: { name: over.name ?? "Anita Rao", phone: over.phone ?? "+91 98123 45678", email: over.email ?? "anita@example.com", address: "", gstin: null },
    property: null,
    serviceAddress: over.address ?? null,
    job: null,
    company: {} as never,
  } as never;
}

export function invoiceDetail(over: { items: ReturnType<typeof line>[]; gst?: boolean; paid?: number; status?: string; quoteNumber?: string | null }) {
  const gst = over.gst !== false;
  const subtotal = over.items.reduce((a, l) => a + l.amount, 0);
  const tax = gst ? Math.round(subtotal * 18) / 100 : 0;
  const total = subtotal + tax;
  const paid = over.paid ?? 0;
  return {
    invoice: { id: "i1", invoiceNumber: gst ? "INV-2627-00007" : "NG-2627-00003", jobId: "j1", customerId: "c1", subtotal, tax, discount: 0, total, amountPaid: paid, balanceDue: total - paid, dueDate: "2026-11-10", status: over.status ?? "UNPAID", issuedAt: "2026-11-07T05:00:00.000Z", items: over.items, notes: "Thank you for choosing Intense Care.", paymentTerms: "Due on completion.", invoiceType: gst ? "GST" : "NON_GST", gstRate: gst ? 18 : 0, cgst: tax / 2, sgst: tax / 2, igst: 0, interState: false, customerGstin: gst ? "29AAAAA0000A1Z5" : undefined, supplierGstin: gst ? "29ABCDE1234F1Z5" : undefined },
    quoteNumber: over.quoteNumber === undefined ? "QT-2627-00042" : over.quoteNumber,
    upi: { vpa: "intensecare@okhdfcbank", payeeName: "Intense Care" },
    job: { id: "j1", jobNumber: "ANITA-RAO-07112026-001", serviceName: "Deep cleaning", serviceDate: "2026-11-09" },
    customer: { name: "Anita Rao", address: "12 MG Road, Bengaluru", serviceAddress: "12 MG Road, Indiranagar, Bengaluru 560038", gstin: gst ? "29AAAAA0000A1Z5" : undefined, phone: "+91 98123 45678", email: "anita@example.com" },
    company: {} as never,
  } as never;
}
