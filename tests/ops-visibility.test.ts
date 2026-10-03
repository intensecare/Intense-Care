/**
 * Deterministic check of getOpsDateVisibility business-timezone math.
 *
 * This host runs IST (like the ops browser). The UTC-server case is proven by
 * the shift INVARIANT: toBusinessWallClock(t) must equal t + 330min whenever
 * the host is UTC (getTimezoneOffset() = 0) — because a UTC host's local
 * getters on that shifted instant then read exactly the IST wall clock.
 * We assert that invariant under a patched getTimezoneOffset(0), then assert
 * the user-visible answers on the real IST host.
 *
 * Run: npx tsx .tz-check/ops-visibility.test.ts
 */
import { getOpsDateVisibility, toBusinessWallClock } from "../src/lib/ops-visibility";

let failures = 0;
function expect(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}${ok ? "" : ` (got ${String(actual)}, want ${String(expected)})`}`);
}

// --- 1. Shift invariant (UTC-server case) -----------------------------------
// A UTC host must land on the IST wall clock: 2026-10-03T15:30Z → 21:00 IST.
const ninePm = new Date("2026-10-03T15:30:00Z");
const originalOffset = Date.prototype.getTimezoneOffset;
Date.prototype.getTimezoneOffset = function () {
  return 0; // simulate a UTC server host for the shift computation
};
const shifted = toBusinessWallClock(ninePm);
Date.prototype.getTimezoneOffset = originalOffset;

expect(
  "UTC host: wall clock lands on 21:00 IST (t + 330min)",
  shifted.toISOString(),
  "2026-10-03T21:00:00.000Z"
);
// Sanity: on the real IST host the shift is a no-op.
expect("IST host: wall clock unchanged", toBusinessWallClock(ninePm).getTime(), ninePm.getTime());

// --- 2. User-visible answers (real IST host) --------------------------------
let v = getOpsDateVisibility(ninePm, { nextDayDispatchTime: "20:00" });
expect("21:00 IST → after cutoff", v.isAfterCutoff, true);
expect("21:00 IST → today", v.today, "2026-10-03");
expect("21:00 IST → tomorrow", v.tomorrow, "2026-10-04");
expect("21:00 IST → tomorrow's job visible", v.isDateVisible("2026-10-04"), true);

v = getOpsDateVisibility(new Date("2026-10-03T14:00:00Z"), { nextDayDispatchTime: "20:00" });
expect("19:30 IST → before cutoff", v.isAfterCutoff, false);
expect("19:30 IST → tomorrow hidden", v.isDateVisible("2026-10-04"), false);
expect("19:30 IST → today visible", v.isDateVisible("2026-10-03"), true);

v = getOpsDateVisibility(new Date("2026-10-03T20:30:00Z"), { nextDayDispatchTime: "20:00" });
expect("02:00 IST Oct 4 → today rolled to Oct 4", v.today, "2026-10-04");
expect("02:00 IST Oct 4 → tomorrow Oct 5", v.tomorrow, "2026-10-05");
expect("02:00 IST Oct 4 → Oct 4 visible", v.isDateVisible("2026-10-04"), true);
expect("02:00 IST Oct 4 → Oct 5 hidden", v.isDateVisible("2026-10-05"), false);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
