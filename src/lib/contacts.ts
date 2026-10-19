/** Phone-contact sync — definitions shared by the server and the app. */

/**
 * What happens to a contact after it is synced:
 *  DIRECTORY_ONLY     (default) it lands in the Contacts directory only. Staff import chosen contacts as leads.
 *  AUTO_NEW_CONTACTS  contacts that first appear AFTER this was approved also become PHONE_CONTACT leads
 *                     (never the contacts already on the phone, never an existing customer or open lead).
 */
export const CONTACT_LEAD_POLICIES = ["DIRECTORY_ONLY", "AUTO_NEW_CONTACTS"] as const;
export type ContactLeadPolicy = (typeof CONTACT_LEAD_POLICIES)[number];

export interface ContactSyncSettings {
  leadPolicy: ContactLeadPolicy;
  /** Who approved automatic lead creation, and when (null while it is off). */
  autoLeadApprovedBy: string | null;
  autoLeadApprovedAt: string | null;
  /** Days a contact removed from the phone stays in the directory before it is purged. */
  removedRetentionDays: number;
}

export const DEFAULT_CONTACT_SYNC: ContactSyncSettings = {
  leadPolicy: "DIRECTORY_ONLY",
  autoLeadApprovedBy: null,
  autoLeadApprovedAt: null,
  removedRetentionDays: 90,
};

/** Limits the server enforces on every upload batch (the app uses the same numbers). */
export const SYNC_LIMITS = {
  maxContactsPerBatch: 200,
  maxRemovedPerBatch: 500,
  maxPhonesPerContact: 20,
  maxEmailsPerContact: 10,
  maxNameLength: 200,
} as const;

export const SYNC_TRIGGERS = ["INITIAL", "APP_OPEN", "RESUME", "MANUAL", "SCHEDULED", "CATCH_UP", "RETRY"] as const;
export type SyncTrigger = (typeof SYNC_TRIGGERS)[number];

/** A contact as the phone sends it. Only these fields ever leave the phone. */
export interface DeviceContact {
  id: string;
  name: string;
  phones: string[];
  emails?: string[];
  /** Device's last-modified time, ms since epoch (when Android reports it). */
  updatedAt?: number;
}

export interface SyncBatchRequest {
  runId: string;
  trigger: SyncTrigger;
  batchIndex: number;
  batchCount: number;
  idempotencyKey: string;
  /** Contacts the phone read in this run (all batches), for the run summary. */
  scannedTotal: number;
  contacts: DeviceContact[];
  removedIds: string[];
  /** The phone's own count of contacts it could not read or send. */
  failedLocal?: number;
  final: boolean;
}

export type RecordFailureCode = "INVALID_RECORD" | "NO_NAME_OR_PHONE" | "SAVE_FAILED";

export interface SyncBatchResult {
  ok: true;
  replayed: boolean;
  runId: string;
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  skipped: number;
  duplicates: number;
  /** Device contact ids only — no names or numbers. */
  failed: { id: string; code: RecordFailureCode }[];
  /** Server-side switches the phone must respect on its next run. */
  paused: boolean;
  nextBatchAllowed: boolean;
}

export interface ContactSyncStatus {
  connected: boolean;
  paused: boolean;
  deviceLabel: string | null;
  lastRun: null | {
    id: string;
    trigger: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    scanned: number;
    added: number;
    updated: number;
    unchanged: number;
    removed: number;
    skipped: number;
    failed: number;
    duplicates: number;
    errorCode: string | null;
  };
  lastSuccessAt: string | null;
  activeContacts: number;
  removedContacts: number;
  potentialDuplicates: number;
  policy: ContactSyncSettings;
}
