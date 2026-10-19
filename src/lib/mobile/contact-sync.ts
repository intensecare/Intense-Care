import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

/**
 * JavaScript side of the native `ContactSync` plugin (android/…/ContactSyncPlugin.java).
 * The phone's contacts are read, diffed and uploaded by native code — a WorkManager job — so the
 * sync does not depend on this page being open. This file only controls it and reads its status.
 */
export type ContactPermission = "granted" | "denied" | "prompt";

export interface LocalRunSummary {
  at: number;
  trigger: string;
  ok: boolean;
  errorCode?: string | null;
  scanned: number;
  added: number;
  updated: number;
  removed: number;
  skipped: number;
  duplicates: number;
  failed: number;
}

export interface NativeSyncStatus {
  supported: boolean;
  deviceId: string;
  enabled: boolean;
  paused: boolean;
  running: boolean;
  permission: ContactPermission;
  /** Android won't show the system prompt again — the user has to open app settings. */
  permissionBlocked: boolean;
  userId: string | null;
  lastRun: LocalRunSummary | null;
  /** Earliest time Android may run the next scheduled sync (a hint, not a promise). */
  nextAttemptAt: number | null;
  pendingBatches: number;
  failedRecords: number;
  contactsOnPhone: number | null;
}

export interface ContactSyncPlugin {
  getStatus(): Promise<NativeSyncStatus>;
  requestPermission(): Promise<{ permission: ContactPermission; blocked: boolean }>;
  openAppSettings(): Promise<void>;
  /** Stores the sync token (Android Keystore) and schedules the periodic job. Does not sync yet. */
  enable(options: { baseUrl: string; token: string; userId: string }): Promise<NativeSyncStatus>;
  syncNow(options?: { trigger?: "MANUAL" | "RESUME" | "INITIAL" }): Promise<{ started: boolean }>;
  retryFailed(): Promise<{ started: boolean }>;
  pause(): Promise<NativeSyncStatus>;
  resume(): Promise<NativeSyncStatus>;
  /** Stops syncing and forgets the token and the local comparison snapshot. */
  disable(): Promise<NativeSyncStatus>;
  /** Sign-out: stop the schedule but keep unsent batches. */
  signedOut(): Promise<void>;
  /** Sign-in: if a different user than the one the token belongs to signs in, the old link is dropped. */
  signedIn(options: { userId: string }): Promise<{ switched: boolean }>;
  addListener(event: "syncState", cb: (s: NativeSyncStatus) => void): Promise<PluginListenerHandle>;
}

export const ContactSync = registerPlugin<ContactSyncPlugin>("ContactSync");
