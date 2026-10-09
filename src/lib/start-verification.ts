/**
 * Job start verification — how a Field Manager proves they are at the job
 * before it starts (the "I'm here" step, which then asks the customer to confirm).
 *
 * Exactly three policies, set by Admin (Settings → Job start verification),
 * optionally overridden per job. GPS_QR reuses the job's one customer QR.
 */
export const START_MODES = ["DIRECT", "GPS", "GPS_QR"] as const;
export type StartMode = (typeof START_MODES)[number];

export interface StartVerificationSettings {
  /** Company default. */
  defaultMode: StartMode;
  /** GPS must place the device within this many metres of the saved job/property location. */
  maxDistanceMeters: number;
  /** The device's reported GPS accuracy must be this good (metres) or better. */
  maxAccuracyMeters: number;
  /** Admin may choose a different mode on an individual job. */
  allowPerJobOverride: boolean;
}

export const DEFAULT_START_VERIFICATION: StartVerificationSettings = {
  defaultMode: "GPS",
  maxDistanceMeters: 300,
  maxAccuracyMeters: 100,
  allowPerJobOverride: true,
};

export const START_MODE_INFO: Record<StartMode, { label: string; action: string; needs: string }> = {
  DIRECT: { label: "Direct Job Start", action: "Start Job", needs: "No GPS or QR needed. Tap Start Job when you arrive." },
  GPS: { label: "GPS Job Start", action: "Verify GPS & Start Job", needs: "Your phone's GPS must place you at the saved job location. Turn on location before you arrive." },
  GPS_QR: { label: "GPS + QR Job Start", action: "Verify GPS + Scan QR", needs: "Your GPS must place you at the saved job location AND you must scan the customer's QR for this job." },
};

/** Older stored values (before the three-mode change) map to the mode that replaced them. */
export function normalizeStartMode(v: unknown): StartMode | null {
  if (v === "QR" || v === "QR_GPS") return "GPS_QR";
  return isStartMode(v) ? v : null;
}
export const modeNeedsGps = (m: StartMode) => m === "GPS" || m === "GPS_QR";
export const modeNeedsQr = (m: StartMode) => m === "GPS_QR";

export const isStartMode = (v: unknown): v is StartMode => typeof v === "string" && (START_MODES as readonly string[]).includes(v);

/** The mode that applies to a job: its own override (when allowed) or the company default. */
export function effectiveStartMode(jobMode: string | null | undefined, s: StartVerificationSettings): StartMode {
  const own = normalizeStartMode(jobMode);
  return s.allowPerJobOverride && own ? own : normalizeStartMode(s.defaultMode) ?? "GPS";
}

/** Label for a stored arrival verification value (new upper-case modes + older lower-case rows). */
export function arrivalMethodLabel(v: string | null | undefined): string {
  switch (v) {
    case "DIRECT": return "Direct start (no location check)";
    case "QR": case "qr": return "QR scan";
    case "QR_GPS": case "GPS_QR": return "GPS + QR scan";
    case "GPS": case "gps": return "GPS";
    case "ADMIN_OVERRIDE": case "admin_override": return "Admin override";
    case "manual": return "Not verified (reason given)";
    default: return v ?? "—";
  }
}
