# Location fix, job-start modes and Lead Management — report

Branch `claude/intense-care-erp-overhaul-5parjk`. Everything below was implemented and tested against a local PostgreSQL 16 database and a production build (`npm run build && npm run start`). Nothing here was run against the live database — see §2 for how to list and repair live records.

## 1. Root causes of missing / wrong locations

Several independent causes, not the map component alone:

| # | Root cause | Effect | Fix |
|---|---|---|---|
| 1 | **Two migrations with the same timestamp created two sets of job location columns.** Commit `d81b1e7` saved job pins in `Job.serviceLat / serviceLng / serviceAddress`; the code merged later reads only `locationLat / locationLng / locationAddress`. | Every job pinned while that version ran shows **no location** (map, navigation, customer page, GPS start). | Migration `20261013000000` copies the legacy pins into the columns the app reads (logged per job). |
| 2 | **A job copied its property's pin once, at booking.** Pinning or correcting the property later never reached its jobs; jobs booked before the property had a pin stayed empty forever. | "The property has a location but the job doesn't", stale pins after a correction. | `Job.locationSource` (`PROPERTY` follows the property, `JOB` = own pin). Property edits update open (not-started) jobs; the server resolves one `serviceLocation` (job pin, else property pin) for every screen; repair migration fills jobs from their property. |
| 3 | **Placeholder / broken coordinates.** `serializeProperty` sent `gpsCoordinates: {lat: 0, lng: 0}` for unpinned properties; nothing stopped (0,0), half pairs (lat without lng) or out-of-range values being saved. | False markers in the Atlantic ("Null Island"), GPS checks against a wrong point. | Placeholder removed; API refuses half pairs / (0,0); DB check constraints on `Property` and `Job`; repair migration clears impossible values (logged). |
| 4 | **Read-only maps with no pin still rendered a map** centred on Bengaluru. | Looked like a saved location that never existed. | A missing pin now shows a warning and "Navigate by address" — never a map. |
| 5 | **Field Manager navigation used only the job's own columns**, falling back to text parsed out of the property title. | Wrong / vague directions when the job had no own pin. | Navigation uses the resolved saved location (pin, else full address). |
| 6 | **Customer page used only the job's own columns** (no property fallback). | Customers saw no location for many jobs. | Uses the resolved location. |
| 7 | **Property form dropped fields**: `postalCode` and `preferredTime` were typed but never sent. | PIN codes never saved. | Sent and saved; structured address fields added. |
| 8 | **Address search** never checked the HTTP status (a 429 / 403 looked like "no results"), ignored the address of a dropped pin, and offered no country restriction. | Silent failures, wrong-country matches. | `res.ok` checked with a plain reason (rate-limited / refused / error), results restricted to `NEXT_PUBLIC_GEOCODE_COUNTRIES` (default `in`), reverse lookup on pin drop / drag / GPS. |
| 9 | **Maps inside dialogs rendered grey** — size computed before the dialog's open animation ended. | "The map doesn't show" in Add/Edit Property and Job location. | `ResizeObserver` → `invalidateSize`. |
| 10 | **Stale `onChange` in map handlers** (registered once) — found by the browser test. | Tapping the map after picking a search result overwrote form fields with old values. | Handlers always call the current `onChange`. |
| 11 | **Device location on plain http** is blocked by browsers without a clear message. | "Use current location" / GPS start silently failed. | Detected (`isSecureContext`) and explained; permission-denied, timeout and unavailable each have their own message. |
| 12 | **Leaflet torn down mid-animation** (navigating right after a marker tap) threw `_leaflet_pos`. | Console errors / broken map on return. | Zoom/fade animations disabled; resize callbacks ignore removed maps. |

Environment / API keys: the provider is OpenStreetMap (tiles + Nominatim); no key is required and none was misconfigured in the code. Public Nominatim is rate-limited (~1 request/second) — see §8.

## 2. Affected database records and safe corrections

I have no access to the production database, so the affected live records can't be listed here. They are listed (and corrected) by:

1. **Migration `20261013000000_location_integrity_start_modes`** (runs on `prisma migrate deploy`). Every correction is written to the new `LocationRepair` table first (entity, action, old value → new value, reason). It only fills empty values or clears values that cannot be a real location — it never overwrites a valid pin:
   - `CLEARED_INVALID` — (0,0), out of range, or lat without lng (Property and Job)
   - `COPIED_LEGACY_JOB_PIN` — job pin recovered from `serviceLat / serviceLng` (+ `serviceAddress`)
   - `COPIED_JOB_PIN_TO_PROPERTY` — property with no pin takes its jobs' pin, only when all those pins agree within ~100 m
   - `COPIED_PROPERTY_PIN` — job with no pin takes its property's pin
   - retired start modes `QR` / `QR_GPS` → `GPS_QR` (jobs and the company default)
2. **`node scripts/location-diagnose.mjs`** — read-only report: properties without a pin, invalid / swapped (lng,lat) pins, pins outside India, jobs with no pin, jobs pointing at a missing property, open jobs with a stale copy, job pins >2 km from their property; plus the full `LocationRepair` history. `--apply` makes only the SAFE fixes (swap a pin that is outside India but inside once swapped; give an open job its property's pin), each logged in `LocationRepair`. `--json` for a machine-readable report.

After deploying, run:
```bash
DATABASE_URL=… node scripts/location-diagnose.mjs        # what was repaired + what still needs a person
psql "$DATABASE_URL" -c 'select * from "LocationRepair" order by "createdAt"'
```
Remaining "No saved map pin" findings need someone to open the property and set the pin — the system does not invent locations.

Tested on a seeded copy with deliberately broken rows (legacy pin, (0,0), half pair, unpinned job on a pinned property, swapped pair): every case was repaired as listed, good rows untouched, and the migration re-ran cleanly (idempotent).

## 3. Location / map fixes (what changed)

- **Property:** property name, full address, address line, locality, city, state, postal code, country, latitude, longitude, location notes, location source (`SEARCH | MAP_PIN | DEVICE_GPS | MANUAL | IMPORTED`), location updated time, last verified time.
- **Location picker** (`LocationPicker`): search by address / area / city / PIN with a list of results to choose from (never auto-picks), tap or drag the pin, current device location (accuracy shown), typed coordinates with half-pair and swapped-pair warnings, remove pin; the address at the pin is filled when empty or offered ("Use this address" / "Keep mine") — a typed address is never overwritten; empty structured fields are filled from the chosen result.
- **Job:** New Job starts from the property's pin; a different pin becomes the job's own; when the property has no pin it can be saved onto the property too. Job Details shows the source ("Using the property's saved pin" / "Pin set for this job only") with **Use property's pin**.
- **One resolved location** (`serviceLocation`) on every job payload; used by Job Details, Field Manager (address, Navigate, GPS check), customer page, Google Calendar, Schedule map.
- **Maps with markers:** Properties → Map view and Schedule → "Show the day on a map"; tapping a marker opens exactly that property / job; records without a pin are counted, not drawn. Properties list shows pin status and a "No pin" filter.
- **Verification data kept separately:** property's saved pin (Property), device GPS reading / accuracy / distance / method / result / times (JobStartVerification). The device reading never overwrites the property; a passed on-site GPS check only sets `locationVerifiedAt`.

## 4. Job-start modes

`DIRECT`, `GPS`, `GPS_QR` (`src/lib/start-verification.ts`, enforced in `src/lib/server/start-verification.ts` and `PATCH /api/jobs/[id]`):

- Settings → Job start verification: default mode (1. Direct, 2. GPS, 3. GPS + QR), distance and accuracy limits, allow per-job mode. Per-job mode on Job Details until the job starts (audited).
- Backend checks: signed-in user, assigned job (scope), allowed status (state machine), mode from the database, GPS distance + accuracy against the saved pin, QR token valid / not expired / not revoked / this job / this property, duplicate starts (compare-and-set: exactly one of simultaneous requests wins).
- GPS_QR reports GPS and QR results separately (`verification.gps`, `verification.qr`) and stores both with their timestamps; both must pass.
- Admin override: reason ≥ 5 characters, recorded with the administrator and time (`ADMIN_OVERRIDE`) in the verification log, activity log and audit log. A Field Manager can never bypass.
- Field Manager screen (mobile): Job ID, service, customer, property, saved service address, Navigate, required mode, verification progress (GPS / QR rows), clear success / error messages, retry. Buttons: **Start Job** / **Verify GPS & Start Job** / **Verify GPS + Scan QR**.
- No new QR types: GPS_QR uses the job's existing customer QR, which contains only a random token.

## 5. Lead Management

See README → *Leads*. Tables `Lead` and `LeadActivity`; APIs `/api/leads`, `/api/leads/[id]`, `/api/leads/log-call`, `/api/leads/google-metrics`, `/api/public/enquiry`, `/api/webhooks/whatsapp`; pages `/leads`, `/leads/[id]`, `/enquiry`; widget `public/enquiry-widget.js`. No new role: Admin holds `leads.view` / `leads.manage`; Field Manager, QC and Tax Officer have no access (tested).

## 6. Database migrations

| Migration | What |
|---|---|
| `20261013000000_location_integrity_start_modes` | `LocationRepair`; Property address / location fields; `Job.locationSource`; data repair; coordinate check constraints; three start modes + stored-value migration; GPS/QR result columns on `JobStartVerification` |
| `20261014000000_lead_management` | `Lead`, `LeadActivity`, `lead_seq`; source / status / lost-reason / value / coordinate checks; unique `convertedJobId` and `externalId` |

Both are additive and idempotent (re-run tested). No data is deleted; the legacy `serviceLat / serviceLng / serviceAddress` columns are left in place.

## 7. Test results

| Suite | Result |
|---|---|
| `npm test` (unit: RBAC, visibility, markdown, ops visibility + new location / start-mode / lead / webhook-signature / Google-metrics tests) | 32 tests + ops checks, all pass |
| `scripts/e2e-verify.mjs` (five user types, job journey, GST, security) | 122 passed, 0 failed |
| `scripts/erp-verify.mjs` (quotations, job location, visibility, GPS+QR start, settings) | 81 passed, 0 failed |
| `scripts/biz-verify.mjs` (expenses, referrals, HR, payroll, assignment, reports) | 187 passed, 0 failed |
| `scripts/start-verify.mjs` (DIRECT / GPS / GPS_QR, invalid / expired / revoked / other-job / other-property QR, unauthorized, duplicates, overrides, policy) | 57 passed, 0 failed |
| `scripts/location-verify.mjs` (new) | 41 passed, 0 failed |
| `scripts/lead-verify.mjs` (new) | 68 passed, 0 failed |
| `scripts/ai-verify.mjs` (Intense AI permissions) | 32 passed, 0 failed |
| Browser (Chromium, 390 px mobile; geocoder and tiles mocked; device GPS emulated) | 46 passed, 0 failed |

Browser checks covered: search shows selectable results and doesn't auto-pick; picking a result; geocoding failure (HTTP 503) and no-results keep the typed address and pin; swapped coordinates flagged and fixed; tap-to-pin; save, refresh and reopen; Properties map markers; Field Manager DIRECT / GPS start with emulated device location; GPS permission denied (clear message, retry, job not started); too far (distance shown, not started); GPS_QR screen with separate progress; Navigate uses the saved pin; Leads dashboard, Log Call, Kanban, lead detail; public enquiry with UTM attribution; no horizontal scroll on Leads, Kanban, lead detail, Properties, New Job, Schedule, Settings, Job Details, Field Manager, enquiry page; no uncaught page errors.

Not tested here (needs real devices / services): GPS on physical phones (only emulated), the live OpenStreetMap / Nominatim services (mocked — the sandbox is offline), the real WhatsApp Cloud API and Google Business Profile API (signature handling, payload parsing and "not configured" paths are tested; live delivery is not), the QR camera scan on a phone (the token check behind it is tested).

## 8. Remaining issues and required configuration

- **Set pins for unpinned properties.** Run `location-diagnose.mjs` after deploying; anything it lists as "No saved map pin" needs a person (GPS mode can't start those jobs; the app says so).
- **Geocoding capacity.** Public Nominatim is free but limited (~1 request/second, fair-use policy). For heavier use set `NEXT_PUBLIC_GEOCODE_URL` to your own Nominatim or a compatible paid service (same `/search` + `/reverse` API) and restrict its key to your domain.
- **HTTPS is required** for device location (phones block it on http).
- **Website form:** set `LEAD_FORM_ALLOWED_ORIGINS` to the company website origin(s) and add the widget snippet (header of `public/enquiry-widget.js`). For heavier spam, add a CAPTCHA (e.g. Cloudflare Turnstile) — not included.
- **WhatsApp:** needs a WhatsApp Business Platform app: `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, callback URL `APP_BASE_URL/api/webhooks/whatsapp`, "messages" subscription. Media messages are noted ("open WhatsApp Business to view"), not downloaded.
- **Google Business Profile:** needs Google API access approval for the Business Profile Performance API and `GOOGLE_BP_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN / _LOCATION_ID`. Counts only — Google does not identify searchers.
- **Google Ads:** conversion tag via `data-ads-send-to` on the widget; offline conversions via the "Google Ads conversions" CSV (manual upload — no automated upload API integration).
- **Phone calls** are logged by hand; automatic call capture needs a telephony provider (e.g. a cloud number with call webhooks).
- **Rate limits are in-memory per server instance** (pre-existing design shared with QR and login limits) and trust `X-Forwarded-For`; on several instances or without a trusted proxy, move them to a shared store.
- The legacy `Job.serviceLat / serviceLng / serviceAddress` columns are unused after the repair and can be dropped in a later migration once the repair log has been reviewed.
