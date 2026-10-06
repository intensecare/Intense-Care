import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(dateString?: string | Date | null): string {
  if (!dateString) return "-";
  const date = typeof dateString === "string" ? new Date(dateString) : dateString;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(dateString?: string | Date | null): string {
  if (!dateString) return "-";
  const date = typeof dateString === "string" ? new Date(dateString) : dateString;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function formatTime(timeString?: string | Date | null): string {
  if (!timeString) return "-";
  const date = typeof timeString === "string" ? new Date(timeString) : timeString;
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/**
 * Returns the local calendar date (YYYY-MM-DD) for a given Date.
 * Uses local timezone instead of UTC so day boundaries match what the user sees.
 */
export function toLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Returns the local calendar date (YYYY-MM-DD) offset by a number of days.
 */
export function toLocalDateOffset(days: number = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toLocalDateString(date);
}

export function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36).toUpperCase().slice(-4);
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${timestamp}${random}`;
}

export function timeAgo(dateString?: string | Date | null): string {
  if (!dateString) return "";
  const date = typeof dateString === "string" ? new Date(dateString) : dateString;
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return "just now";
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
  return formatDate(date);
}

/**
 * Formats "20:00" (24h) as "08:00 PM". Falls back to the raw string if unparseable.
 */
export function format24hTo12h(time24?: string | null): string {
  if (!time24) return "-";
  const [hourStr, minuteStr] = time24.split(":");
  const hour = Number(hourStr);
  if (Number.isNaN(hour)) return time24;
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(hour12).padStart(2, "0")}:${minuteStr || "00"} ${suffix}`;
}

/**
 * Renders a job's scheduled time slot in 12h form: "09:00 - 13:30" →
 * "09:00 AM - 01:30 PM". Free windows are stored as "HH:MM - HH:MM" (24h);
 * legacy strings ("09:00 AM - 01:30 PM" etc.) pass through unchanged.
 */
export function formatTimeSlot(slot?: string | null): string {
  if (!slot) return "-";
  const m = slot.match(/^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/);
  if (!m) return slot;
  const to12 = (h: string, min: string) => {
    const hour = Number(h);
    const suffix = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${String(hour12).padStart(2, "0")}:${min} ${suffix}`;
  };
  return `${to12(m[1], m[2])} - ${to12(m[3], m[4])}`;
}

const ONES_IN_WORDS = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS_IN_WORDS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigitsInWords(n: number): string {
  if (n < 20) return ONES_IN_WORDS[n];
  return `${TENS_IN_WORDS[Math.floor(n / 10)]}${n % 10 ? " " + ONES_IN_WORDS[n % 10] : ""}`;
}

function threeDigitsInWords(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(`${ONES_IN_WORDS[hundreds]} Hundred`);
  if (rest) parts.push(twoDigitsInWords(rest));
  return parts.join(" ");
}

/**
 * Renders an amount in Indian-format words for statutory documents, e.g.
 * 125430 → "One Lakh Twenty Five Thousand Four Hundred Thirty". Whole rupees
 * only (invoices store whole-rupee figures). Returns "" for non-positive or
 * unparseable input so callers can skip the line entirely.
 */
export function amountInWords(amount: number): string {
  const n = Math.round(Number(amount));
  if (!Number.isFinite(n) || n <= 0) return "";
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor(n / 100_000) % 100;
  const thousand = Math.floor(n / 1_000) % 100;
  const rest = n % 1_000;
  const parts: string[] = [];
  if (crore) parts.push(`${threeDigitsInWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigitsInWords(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigitsInWords(thousand)} Thousand`);
  if (rest) parts.push(threeDigitsInWords(rest));
  return parts.join(" ");
}

/**
 * Builds a wa.me deep link with a prefilled message. `phone` is normalized to
 * WhatsApp's international format (digits only; a bare 10-digit Indian number
 * gets the 91 country code). Without a phone the universal share endpoint is
 * used so the sender picks the chat themselves.
 */
export function buildWhatsAppShareUrl(phone: string | undefined | null, message: string): string {
  const digits = (phone || "").replace(/\D/g, "");
  const normalized = digits.length === 10 ? `91${digits}` : digits;
  const text = encodeURIComponent(message);
  return normalized
    ? `https://wa.me/${normalized}?text=${text}`
    : `https://wa.me/?text=${text}`;
}
