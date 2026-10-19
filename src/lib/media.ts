/** Media & Storage — definitions shared by the server and the app. */

export const MEDIA_CATEGORIES = ["BEFORE", "AFTER", "QC", "CUSTOMER_ATTACHMENT", "FINANCIAL_DOCUMENT", "OTHER"] as const;
export type MediaCategory = (typeof MEDIA_CATEGORIES)[number];
export const MEDIA_CATEGORY_LABEL: Record<MediaCategory, string> = {
  BEFORE: "Before-service photos",
  AFTER: "After-service photos",
  QC: "QC & rework photos",
  CUSTOMER_ATTACHMENT: "Customer attachments",
  FINANCIAL_DOCUMENT: "Invoice, quotation & expense documents",
  OTHER: "Other business attachments",
};

export const MEDIA_TYPES = ["image", "video", "document"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/**
 * How freely a file may be removed:
 *  FREE       nothing refers to it — remove after the normal confirmation.
 *  CONFIRM    it belonged to a closed record but is past its retention period — normal confirmation.
 *  PROTECTED  business-critical (QC evidence, before/after photos of a finished job, financial documents
 *             within retention) — only with an explicit written reason; kept in the permanent audit trail.
 *  LOCKED     required right now (job in progress, open complaint, unpaid invoice, expense awaiting approval) — cannot be removed.
 */
export const PROTECTION_LEVELS = ["FREE", "CONFIRM", "PROTECTED", "LOCKED"] as const;
export type ProtectionLevel = (typeof PROTECTION_LEVELS)[number];

/** Text an Admin must type to remove PROTECTED media. */
export const PROTECTED_DELETE_PHRASE = "DELETE PROTECTED MEDIA";

export type MediaKind = "JOB_PHOTO" | "EXPENSE_RECEIPT" | "CLOUD_ORPHAN";

export interface MediaItem {
  /** "jp:<id>" job photo · "rc:<id>" stored receipt · "cl:<publicId>" cloud file with no ERP record */
  id: string;
  kind: MediaKind;
  category: MediaCategory;
  type: MediaType;
  name: string;
  format: string | null;
  bytes: number | null;
  uploadedAt: string | null;
  uploadedBy: string | null;
  jobId: string | null;
  jobSerial: string | null;
  customerName: string | null;
  thumbnailUrl: string | null;
  url: string | null;
  /** Is it referenced by a business record? */
  referenced: boolean;
  references: string[];
  protection: { level: ProtectionLevel; reasons: string[] };
}

export interface MediaQuotaView {
  usedBytes: number | null;
  limitBytes: number | null;
  /** Where the limit comes from: the storage provider, or a limit an Admin configured. Never invented. */
  limitSource: "provider" | "configured" | null;
  usedPercent: number | null;
  level: "OK" | "WARN" | "FULL" | "UNKNOWN";
  message: string | null;
}

export interface MediaSummary {
  managed: {
    files: number;
    bytes: number;
    byCategory: Record<MediaCategory, { files: number; bytes: number }>;
    byType: Record<MediaType, { files: number; bytes: number }>;
  };
  provider: {
    name: string;
    configured: boolean;
    /** Account-wide figures the provider reported (it may include files that aren't in the ERP). */
    usageBytes: number | null;
    plan: string | null;
    error: string | null;
    fetchedAt: string | null;
  };
  /** Size of the files the ERP manages — an ESTIMATE of what it uses in the provider. */
  estimateBytes: number;
  quota: MediaQuotaView;
  largest: MediaItem[];
  recommendations: { key: string; title: string; detail: string; files: number; bytes: number; filter: string }[];
}

export const formatBytes = (n: number | null | undefined): string => {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${u[i]}`;
};
