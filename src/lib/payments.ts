/**
 * UPI payment rules shared by the server and the pages — pure, unit-tested.
 *
 * The one thing to remember: opening a UPI app, or coming back from it, proves NOTHING. Money only counts when an
 * authorised Admin has checked it arrived and recorded it. Everything here is built around that.
 */

export interface UpiSettings {
  enabled: boolean;
  /** Business UPI ID (VPA), e.g. "intensecare@okhdfcbank". Empty until the Admin enters it — never hard-coded. */
  vpa: string;
  /** Name shown in the customer's UPI app (should match the account holder). */
  payeeName: string;
  /** Optional note sent with the payment (UPI limits it to ~50 characters). */
  description: string;
}

export const DEFAULT_UPI_SETTINGS: UpiSettings = { enabled: false, vpa: "", payeeName: "", description: "" };

/** name@handle — letters, digits and . _ - in the name; a bank/app handle of letters/digits after the @. */
const VPA = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}@[a-zA-Z][a-zA-Z0-9]{2,31}$/;
export const isValidVpa = (v: string) => VPA.test(v.trim());
/** What a person's name looks like on a UPI screen: letters, digits, spaces and . & ' - only. */
export const isValidPayeeName = (v: string) => /^[A-Za-z0-9][A-Za-z0-9 .&'-]{1,59}$/.test(v.trim());

export type UpiConfigProblem = "DISABLED" | "NO_VPA" | "BAD_VPA" | "NO_NAME" | "BAD_NAME";

/** null = ready to take payments. */
export function upiProblem(s: UpiSettings | null | undefined): UpiConfigProblem | null {
  if (!s || !s.enabled) return "DISABLED";
  if (!s.vpa.trim()) return "NO_VPA";
  if (!isValidVpa(s.vpa)) return "BAD_VPA";
  if (!s.payeeName.trim()) return "NO_NAME";
  if (!isValidPayeeName(s.payeeName)) return "BAD_NAME";
  return null;
}
export const upiReady = (s: UpiSettings | null | undefined) => upiProblem(s) === null;

export const UPI_PROBLEM_TEXT: Record<UpiConfigProblem, string> = {
  DISABLED: "UPI payments are switched off.",
  NO_VPA: "Enter the business UPI ID.",
  BAD_VPA: "That UPI ID isn't valid. It looks like name@bank (for example shop@okhdfcbank).",
  NO_NAME: "Enter the payee name customers will see in their UPI app.",
  BAD_NAME: "The payee name can use letters, numbers, spaces and . & ' - only (2–60 characters).",
};

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** "intensecare@okhdfcbank" → "in•••••••@okhdfcbank" for places that don't need the full ID. */
export function maskVpa(v: string): string {
  const [name, handle] = v.split("@");
  if (!handle) return "•••";
  return `${name.slice(0, 2)}${"•".repeat(Math.max(3, name.length - 2))}@${handle}`;
}

/**
 * The standard UPI payment link (NPCI deep-link spec): upi://pay?pa=&pn=&am=&cu=INR&tn=&tr=
 *   pa payee VPA · pn payee name · am amount (2 decimals, > 0) · cu currency · tn note · tr unique reference
 * Values are percent-encoded; the "@" in the VPA is left as is (every app accepts it and some mishandle %40).
 */
export function buildUpiUri(p: { vpa: string; payeeName: string; amount: number; note: string; reference: string }): string {
  const amount = round2(p.amount);
  if (!(amount > 0) || amount > 1_000_000) throw new Error("A UPI payment needs an amount above zero (and at most ₹10,00,000).");
  if (!isValidVpa(p.vpa)) throw new Error("Invalid UPI ID.");
  const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  const q = [
    `pa=${p.vpa.trim()}`,
    `pn=${enc(p.payeeName.trim())}`,
    `am=${amount.toFixed(2)}`,
    "cu=INR",
    `tn=${enc(p.note.trim().slice(0, 50))}`,
    `tr=${enc(p.reference)}`,
  ];
  return `upi://pay?${q.join("&")}`;
}

/** The note shown in the payer's app: Admin's description, or the invoice number. Never customer names. */
export function paymentNote(description: string, invoiceNumber: string): string {
  const d = description.trim();
  return (d ? `${d} ${invoiceNumber}` : `Invoice ${invoiceNumber}`).replace(/[^\w .#/-]/g, "").slice(0, 50);
}

/** A reference a payment app is happy to echo back: letters and digits, ≤ 35 chars (UPI limit). */
export function newAttemptReference(now = Date.now(), rand = Math.random()): string {
  return `ICP${now.toString(36).toUpperCase()}${Math.floor(rand * 36 ** 5).toString(36).toUpperCase().padStart(5, "0")}`.slice(0, 35);
}

/** UTR / UPI reference: banks print 12 digits; some apps show longer alphanumeric ids (e.g. T2410…). */
export function normalizeUtr(raw: string): string | null {
  const t = (raw ?? "").replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z0-9]{8,35}$/.test(t) ? t : null;
}

/* ---------------------------------------------------------------- statuses */

export const ATTEMPT_STATUSES = ["INITIATED", "SUBMITTED", "VERIFIED", "REJECTED", "CANCELLED"] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

/** An opened-but-never-reported payment link stops counting as "initiated" after this long. */
export const INITIATED_TTL_MS = 2 * 60 * 60 * 1000;

/** What the customer (and the Admin lists) see. Kept separate from the invoice's own status and from the job's status. */
export const CUSTOMER_PAYMENT_STATUSES = ["UNPAID", "PAYMENT_INITIATED", "PAID", "FAILED", "PARTIALLY_PAID", "PAYMENT_REVIEW_REQUIRED"] as const;
export type CustomerPaymentStatus = (typeof CUSTOMER_PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABEL: Record<CustomerPaymentStatus, string> = {
  UNPAID: "Unpaid",
  PAYMENT_INITIATED: "Payment started — not confirmed",
  PAID: "Paid",
  FAILED: "Payment not confirmed",
  PARTIALLY_PAID: "Partly paid",
  PAYMENT_REVIEW_REQUIRED: "Payment submitted — being checked",
};

export interface AttemptLike {
  status: string;
  createdAt: Date | string;
  reviewedAt?: Date | string | null;
}

/**
 * The payment status of an invoice for display. `invoiceStatus` is the invoice's own ledger status
 * (UNPAID | PARTIAL | PAID | REFUNDED | CANCELLED) — only an Admin-recorded payment moves that.
 */
export function customerPaymentStatus(invoiceStatus: string, attempts: AttemptLike[], now = Date.now()): CustomerPaymentStatus {
  if (invoiceStatus === "PAID") return "PAID";
  if (attempts.some((a) => a.status === "SUBMITTED")) return "PAYMENT_REVIEW_REQUIRED";
  const fresh = attempts.some((a) => a.status === "INITIATED" && now - new Date(a.createdAt).getTime() < INITIATED_TTL_MS);
  if (fresh) return "PAYMENT_INITIATED";
  const lastRejected = attempts
    .filter((a) => a.status === "REJECTED")
    .map((a) => new Date(a.reviewedAt ?? a.createdAt).getTime())
    .sort((x, y) => y - x)[0];
  if (lastRejected !== undefined && invoiceStatus !== "PARTIAL") return "FAILED";
  return invoiceStatus === "PARTIAL" ? "PARTIALLY_PAID" : "UNPAID";
}
