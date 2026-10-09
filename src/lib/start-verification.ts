/**
 * Job start verification — how a Field Manager proves they are at the job
 * before it starts (the "I'm here" step, which then asks the customer to confirm).
 *
 * Four alternative policies, set by Admin (Settings → Job start verification),
 * optionally overridden per job. All of them reuse the job's customer QR link.
 */
export const START_MODES = ["DIRECT", "QR", "QR_GPS", "GPS"] as const;
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
  DIRECT: { label: "Direct job start", action: "Start Job", needs: "No location check. Tap Start Job when you arrive." },
  QR: { label: "QR job start", action: "Scan QR to Start", needs: "Scan the customer's QR code for this job when you arrive." },
  QR_GPS: { label: "QR + GPS", action: "Verify GPS + Scan QR", needs: "Your GPS must place you at the property AND you must scan the customer's QR code." },
  GPS: { label: "GPS only", action: "Verify GPS & Start Job", needs: "Your GPS must place you at the property. Turn on location before you arrive." },
};

export const isStartMode = (v: unknown): v is StartMode => typeof v === "string" && (START_MODES as readonly string[]).includes(v);

/** The mode that applies to a job: its own override (when allowed) or the company default. */
export function effectiveStartMode(jobMode: string | null | undefined, s: StartVerificationSettings): StartMode {
  return s.allowPerJobOverride && isStartMode(jobMode) ? jobMode : s.defaultMode;
}

/** Label for a stored arrival verification value (new upper-case modes + older lower-case rows). */
export function arrivalMethodLabel(v: string | null | undefined): string {
  switch (v) {
    case "DIRECT": return "Direct start (no location check)";
    case "QR": case "qr": return "QR scan";
    case "QR_GPS": return "GPS + QR scan";
    case "GPS": case "gps": return "GPS";
    case "ADMIN_OVERRIDE": case "admin_override": return "Admin override";
    case "manual": return "Not verified (reason given)";
    default: return v ?? "—";
  }
}
