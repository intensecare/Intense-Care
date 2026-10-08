import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const TZ = process.env.NEXT_PUBLIC_BUSINESS_TIMEZONE || "Asia/Kolkata";

/** Paise → "₹1,250" (or "₹1,250.50" when there are paise). */
export function money(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/** Rupees (number from a form) → integer paise. */
export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function formatDate(d?: string | Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" }).format(new Date(d));
}

export function formatDateTime(d?: string | Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(d));
}

export function formatTime(d?: string | Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(d));
}

/** Digits only; a bare 10-digit Indian number gets the 91 country code. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
}

/** 919876543210 → "+91 98765 43210". */
export function displayPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  return d ? `+${d}` : "";
}

export const UNIT_LABEL: Record<string, string> = { PIECE: "piece", KG: "kg", PAIR: "pair", SET: "set" };

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  CARD: "Card",
  BANK_TRANSFER: "Bank transfer",
};

export function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function whatsappUrl(phone: string, text: string): string {
  const d = phone.replace(/\D/g, "");
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}
