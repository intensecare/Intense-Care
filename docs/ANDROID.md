# Intense Care — Android app, contact sync, media storage

This document is the engineering handbook for the Android app and the server features it needs.
**Read "What was and wasn't tested" first** — several things below are implemented and unit/integration-tested here,
but have *not* been run on a phone, and one (the APK build) could not be run in the environment this was written in.

1. [Architecture](#1-architecture)
2. [What was and wasn't tested](#2-what-was-and-wasnt-tested)
3. [Building the APK / AAB](#3-building-the-apk--aab)
4. [Configuration](#4-configuration)
5. [Continuous contact sync](#5-continuous-contact-sync)
6. [Media & Storage](#6-media--storage)
7. [Device storage](#7-device-storage)
8. [Photos, camera, QR and GPS](#8-photos-camera-qr-and-gps)
9. [Push notifications](#9-push-notifications)
10. [Security and roles](#10-security-and-roles)
11. [Updating the app — what needs a new build](#11-updating-the-app--what-needs-a-new-build)
12. [Google Play](#12-google-play)
13. [Real-device test plan](#13-real-device-test-plan)
14. [Known limitations](#14-known-limitations)
15. [Database migration, API and file map](#15-database-migration-api-and-file-map)

---

## 1. Architecture

**Audit result.** The ERP is a Next.js 14 app with server-rendered pages, ~100 API route handlers, cookie-session
middleware (`src/middleware.ts`), Prisma 7 + PostgreSQL and Cloudinary. It **cannot** be exported as a static site
(`next export`): login, every API, the role checks and the database live on the server.

**Chosen architecture (the simplest that works):** a thin Capacitor 8 Android shell that loads the **hosted ERP**
in a WebView (`server.url` in `capacitor.config.ts`), plus a small amount of native code for what a web page cannot do reliably.

```
 Android app (Capacitor)                                  Hosted ERP (unchanged hosting)
┌──────────────────────────────────────┐   HTTPS only   ┌───────────────────────────────┐
│ WebView → https://erp.…  (same pages) │ ─────────────▶ │ Next.js pages + /api routes   │
│  cookie session, same roles/RBAC      │   cookie       │ Prisma / PostgreSQL           │
│                                      │                │ Cloudinary (media)            │
│ Native Java                           │                │ FCM (push)                    │
│  • ContactSync plugin + WorkManager   │ ─ bearer token▶│ /api/mobile/contacts/sync …   │
│  • DeviceStorage plugin               │  (scoped, per  │                               │
│  • Capacitor camera/geo/ML Kit QR/    │   device)      │                               │
│    push/app/network plugins           │                │                               │
└──────────────────────────────────────┘                └───────────────────────────────┘
```

- **No ERP data or secrets are in the app.** It holds the server address, nothing else. Cloudinary, FCM and database
  secrets stay on the server. The login session is the normal HttpOnly cookie, first-party to the ERP origin.
- **Navigation is locked to the ERP host** (`allowNavigation`); other links open in the system browser. If the server
  can't be reached the app shows `mobile/www/offline.html` (retry button) instead of a blank screen.
- **The background contact sync does not use the WebView or the cookie.** WorkManager runs native Java that talks to
  the ERP with its own **scoped device token** (`icd_…`): created when an Admin turns sync on, usable *only* for the
  contact-sync endpoints, bound to one phone and one user, revocable, stored on the server only as a SHA-256 hash and on
  the phone only encrypted with an Android Keystore key.
- **One codebase for UI.** The same pages work in a browser; `src/lib/mobile/*` and `src/components/mobile/NativeBridge.tsx`
  add native behaviour only when `window.Capacitor` says it is running in the app.
- **Package versions** (compatible set, all Capacitor 8): `@capacitor/core|cli|android 8.5.x`, `app`, `camera`,
  `geolocation`, `keyboard`, `network`, `push-notifications`, `splash-screen`, `status-bar`, `@capacitor-mlkit/barcode-scanning 8.x`;
  AndroidX WorkManager 2.10. Android `minSdk 24`, `compileSdk/targetSdk 36`, Java 21.

## 2. What was and wasn't tested

> **Continuous contact synchronisation has NOT been tested on a real device under real background and battery
> conditions.** Do not describe it as working in production until the checklist in [§13](#13-real-device-test-plan) is done.

| Area | How it was tested | Result |
|---|---|---|
| Server: devices, tokens, contact sync, dedupe, lead policy, retention, disconnect, push (fake FCM), media + deletion rules (fake Cloudinary) | `scripts/mobile-verify.mjs` against the **real built server and a real PostgreSQL** | 118 checks pass (117 without the optional `SERVER_LOG` PII check) |
| Android sync engine (Java): phone-number normalisation vs the *same vectors as the server*, change detection, batching, idempotency keys, resume after a dropped connection, mass-removal guard, throttling, pause/auth/permission handling, encrypted state, HTTPS-only, redirects not followed | JUnit on a plain JVM (`android/app/src/test/…`, 29 tests) | pass |
| Java client ⇄ real server wire compatibility | `ServerWireIT` via `scripts/mobile-wire-check.sh` (the Java engine + `HttpUploader` syncing 231 contacts into the running server; repeat = no changes; rename = update; removal) | pass |
| Android-specific Java (`sync/android/*`: `AndroidContactSource`, `KeystoreKeyProvider`, `SyncSettings`, `SyncRunner`, `SyncScheduler`, `ContactSyncWorker`; plus the two plugins and `MainActivity`) | **Compiles** against the real Android 16 (API 36) framework jar, with hand-written stubs for Capacitor and WorkManager | compiles; **not executed** |
| Web screens (Contacts / Contact sync, Media & Storage, Device storage) inside a *mock* Android bridge, real server | `scripts/mobile-ui-verify.mjs` (Playwright/Chromium, 390 px phone viewport) | 60 checks pass |
| Photo upload queue (offline → retry → confirmed, FAILED not retried forever, no double send) | `tests/upload-queue.test.ts` (fake IndexedDB + scripted XHR) | 8 tests pass |
| Existing ERP suites after the changes | `npm test`, `e2e-verify`, `erp-verify`, `biz-verify`, `start-verify`, `location-verify`, `lead-verify`, `ai-verify`, `tsc`, `lint`, `next build` | all pass |

**Not done / not possible in the environment this was built in:**

- **The APK/AAB was not built.** The sandbox had no Android SDK and could not reach `dl.google.com` / Google Maven
  (needed for the SDK, the Android Gradle Plugin and AndroidX). Gradle files were updated and the Java compiles
  against the real platform API, but `./gradlew assembleDebug` has never run. Expect to fix small build issues on first build.
- **No real phone or emulator** — so nothing about WorkManager timing, Doze/battery saver, the Android permission
  dialogs, the Keystore, the camera / ML Kit scanner, Capacitor's GPS, FCM delivery, or the WebView experience was observed.
- Cloudinary and FCM were exercised only through local fakes (`scripts/fake-providers.mjs`) that run the **real** SDK / client code.
- Edge-to-edge: with `targetSdk 36` Android 15+ draws apps edge-to-edge; check on a device that headers/bottom bars aren't covered (see §14).

## 3. Building the APK / AAB

Prerequisites on the build machine: Node 18+, **JDK 21**, Android Studio or the command-line SDK
(`ANDROID_HOME`, platform 36, build-tools 36). First time: `npm ci`.

```bash
# Debug APK for testing on a phone (debug-signed, may talk to a dev server)
CAP_SERVER_URL=https://erp.yourcompany.com scripts/android-build.sh apk
#   → android/app/build/outputs/apk/debug/app-debug.apk   (adb install -r …)

# Play Store bundle (release-signed)
cp android/keystore.properties.example android/keystore.properties   # fill in; git-ignored
APP_VERSION_CODE=1 APP_VERSION_NAME=1.0.0 CAP_SERVER_URL=https://erp.yourcompany.com scripts/android-build.sh aab
#   → android/app/build/outputs/bundle/release/app-release.aab
```

What the script does: `npm ci` → `npx cap sync android` (bakes `CAP_SERVER_URL` into the generated
`android/app/src/main/assets/capacitor.config.json`, which is **not committed**) → Gradle.

- **Create the release keystore once and back it up** (`keytool -genkeypair -v -keystore intense-care-release.jks -alias intense-care -keyalg RSA -keysize 2048 -validity 10000`).
  With Play App Signing, this is the *upload* key; losing it is recoverable, but only through Google support.
- Raise `APP_VERSION_CODE` for every Play upload.
- `CAP_SERVER_URL` must be `https://` for release builds (the script and `capacitor.config.ts` both refuse otherwise).
  Plain http works only for **debug** builds against `10.0.2.2` / `localhost` (`CAP_ALLOW_CLEARTEXT=1`, debug network-security config).
- Launcher icons and splash are generated from `public/logo.png`: `python3 scripts/generate-android-icons.py` (Pillow).
- Plugin list changed? `npx cap sync android` regenerates `android/app/capacitor.build.gradle` and `capacitor.settings.gradle` (commit them).

**Push (optional, but needed for notifications):** create a Firebase project, add an Android app with the package
`com.intensecare.erp` (or your `CAP_APP_ID`), download `google-services.json` into `android/app/` (**git-ignore it if you prefer;
it has no private key**), and give the *server* the service-account key as `FCM_SERVICE_ACCOUNT_JSON`. Without
`google-services.json` the app builds and runs; push registration just fails quietly.

## 4. Configuration

All variables are listed in `.env.example` (section "Android app, contact sync, media storage, push notifications").

| Where | Variable | Purpose |
|---|---|---|
| Build machine | `CAP_SERVER_URL`, `CAP_APP_ID`, `CAP_ALLOW_CLEARTEXT`, `CAP_DEBUG_WEBVIEW`, `APP_VERSION_CODE/NAME` | the shell |
| Server | `CRON_SECRET` | enables `/api/cron/maintenance` |
| Server | `FCM_SERVICE_ACCOUNT_JSON` | push |
| Server | `DEFAULT_COUNTRY_CODE` (91) | numbers saved without a country code. **The Java side uses 91 too** (`SyncRunner`); change both if you operate elsewhere |
| Server | `MEDIA_STORAGE_QUOTA_MB`, `MEDIA_WARN_PERCENT`, `MEDIA_EVIDENCE_RETENTION_DAYS`, `MEDIA_FINANCIAL_RETENTION_DAYS` | media rules |
| Server | existing `CLOUDINARY_*` | media storage (unchanged provider) |

**Scheduling the maintenance job.** The ERP has no timers of its own. Call
`GET https://<erp>/api/cron/maintenance` with `Authorization: Bearer $CRON_SECRET` about **every 15 minutes**. It:
sends job reminders (jobs starting soon), sends lead follow-up alerts (once a day per user), purges contacts that were
removed from a phone longer ago than the retention period, and trims old sync records. Safe to run more often or twice
(everything is de-duplicated). Vercel Cron on the Hobby plan is limited to daily runs — use a paid plan, GitHub Actions
`schedule`, or an external scheduler instead. Not scheduling it only disables reminders and retention purges.

## 5. Continuous contact sync

### Who and how
Only **Admin** can connect a phone for contact sync (`contacts.sync` permission). Field Managers and QC can register
their phones for notifications but cannot obtain a sync token (the server answers 403).

**Turning it on (Contacts → Contact sync, in the app):**
1. The screen explains what will be read and used; nothing is requested yet.
2. *Continue* → Android's Contacts permission dialog. Refused → a clear message; nothing is enabled or uploaded.
   "Don't ask again" → the screen explains how to enable it in Android Settings and offers an *Open settings* button.
3. Granted → the app registers the phone, receives a scoped token, stores it Keystore-encrypted, schedules the
   periodic job and starts the **initial import**.

**Controls:** Sync now · Retry failed · Review duplicates · Pause / Resume · Disconnect (optionally also deleting what this
phone uploaded). **Status:** last successful sync, next attempt (explicitly "Android decides the exact time"), contacts
scanned / added / updated / possible duplicates / failed, current permission status, and clear messages for
*permission revoked*, *last attempt failed (reason)*, and *sync is delayed (last success > 24 h)*.

### When it runs
- **On app open / resume** (throttled to once per 10 minutes), **Sync now**, **Retry failed**.
- **Scheduled:** WorkManager periodic job, *about* every 6 hours (flex 2 h) when there is a network connection and the
  battery isn't low. **Android may delay it** (Doze, battery saver, app standby buckets, no connectivity). The app never
  promises an interval.
- **Catch-up:** if the last successful sync is older than 12 h when the app is opened or the user signs in, a one-off
  catch-up run is queued.
- One sync at a time (process-wide guard); a stopped worker keeps the progress it already confirmed.

### What is sent
Per contact: Android contact id, display name, phone numbers (raw — the server normalises), emails, last-updated time.
Nothing else (no photos, notes, addresses, groups, accounts). Batches of ≤ 200 contacts (+ ≤ 500 removed ids), HTTPS only.

### Incremental sync and de-duplication
- The phone keeps an **encrypted snapshot** of what the server has *acknowledged* (contact id → content hash). Each run
  reads the address book, compares and sends only **new, changed (name / numbers / emails) and removed** contacts.
  The snapshot advances only after the server confirms a batch, so anything unsent or failed is simply "changed" again next time.
- Numbers are normalised identically on phone and server (shared test vectors): `+919845012345`, `09845012345`,
  `98450 12345`, `+91 98450-12345` are one number; **matching key = last 10 digits**.
- Server-side, a **mapping table** (`PhoneContact` keyed by `deviceRowId + deviceContactId`) makes repeat syncs *update*,
  never create a second row. Customers and leads are matched **by phone number only — never by name**. One person with
  several numbers, or one number on several contacts, is never merged; those cases appear under **Duplicates** for a person to review.
- A contact whose number belongs to an existing customer is *linked*, not duplicated. Syncing never creates a customer.
- **Removed on the phone** → marked `REMOVED` in the directory and purged after the retention period (default 90 days,
  Settings on the Contacts screen). **Sync never deletes or edits a customer or lead.**
- A sudden drop of > 50 % of contacts (failed read, account re-sync) is **held for one more run** before removals are sent.
- Android merging two contacts changes the Android contact id → shown as one removed + one updated contact; harmless.

### Contacts → leads (configurable, safe default)
`Contacts → Settings`:
- **Directory only** (default). Synced contacts go to the Contacts directory and nothing else. Staff select contacts and
  **Import as leads** (source `PHONE_CONTACT`); existing customers are skipped; importing twice creates one lead.
- **Also create a lead for each NEW contact** — only after an Admin ticks an explicit approval (name + time recorded).
  Applies only to contacts that appear *after* approval, never to the initial import, never to existing customers or
  contacts that already have an open lead, capped at 25 per batch.

### Server privacy and retention
Authenticated, per-device and per-user; paginated/batched; idempotency keys; rate limited; HTTPS enforced in production; data encrypted
in transit (TLS) and **at rest by your database / hosting provider** (the app does not add column-level encryption — enable
disk/DB encryption on your host); logs and run records carry **counts and codes only** (the e2e checks that no name or number appears in server logs).
Retention: removed contacts → purged after N days; batch records → 14 days; run records → 180 days; **Disconnect + delete contacts**
removes everything a phone uploaded. Admin actions are audit-logged (`DEVICE_SYNC_CONNECTED/PAUSED/RESUMED/DISCONNECTED`, `CONTACTS_EXPORTED`, `CONTACTS_DELETED`, …).

### Account switching, logout, uninstall
- **Logout** stops the background schedule for that account and the push token, but keeps the connection and any unsent
  state; signing back in as the **same** user resumes. Signing in as a **different** user disconnects the previous link
  (and revokes its token on the server) — contacts never flow into the wrong account. Photos waiting to upload are never deleted by logout.
- **Uninstall** removes the phone-side state; revoke the phone under *Contacts → Connected phones* (Disconnect / delete contacts).

## 6. Media & Storage

**Admin → Settings → Media & Storage** (`/media`; permission `media.view`, deleting needs `media.manage`).

- **Usage and quota.** Shows what the storage provider (Cloudinary) reports. A limit is shown only if the provider reports one or
  you configured `MEDIA_STORAGE_QUOTA_MB`; otherwise it says "Not reported" and the usage is a clearly-labelled **estimate**
  from the ERP's own records. Warning at `MEDIA_WARN_PERCENT` (default 85 %): *"Storage is almost full. Review large files or remove unnecessary media."*
- **List** (paginated): thumbnail, name, category (before / after / QC & rework / customer attachment / invoice-quotation-expense documents / other),
  size, type, upload date, uploader, customer, **Job ID**, whether a record uses it, protection level. **Filters:** search, category,
  type, minimum size, referenced yes/no, protection level. **Sort:** newest, oldest, largest, smallest, name.
- **Safe-cleanup suggestions** and an **Unreferenced files** tab (receipts attached to no expense; cloud files with no ERP record older than 24 h;
  photo records whose cloud file is missing).
- **Deletion** (single or multiple): *Review & delete* shows each file's name, size, type, Job ID and whether a record uses it, then
  asks for confirmation. Rules (re-checked on the server at delete time):

| Level | Meaning | Deleting |
|---|---|---|
| **FREE** | nothing depends on it (cancelled job, voided/missing expense, orphan) | normal confirmation |
| **CONFIRM** | closed record past its retention period | normal confirmation |
| **PROTECTED** | evidence/financial record still within retention (QC photos, before/after of a finished job, receipts) | only with a written reason (≥ 10 chars) **and** typing `DELETE PROTECTED MEDIA`; written to the permanent `MediaDeletion` audit and the audit log |
| **LOCKED** | needed now: job in progress, open complaint, unpaid invoice, expense awaiting approval, automatic payroll/freelance/referral expense, uploaded < 24 h ago | **cannot be deleted** |

The cloud file is removed **first**; the ERP record is changed only after the provider confirms, so a provider failure never leaves a broken link
(verified by test). Field Managers can still delete their *own* photo while the job is in progress; after the work is handed to QC the legacy
delete is refused and only this screen applies the rules.

Retention defaults: finished-job evidence 365 days, financial documents 2190 days (6 years) — **confirm these with your accountant / legal advisor**; they are configuration, not legal advice.

## 7. Device storage

`/device-storage` (Profile → *Device storage & notifications* for Field Managers/QC; Settings for Admin; also reachable from a notification).

- **Shows:** temporary cache size, photos waiting to upload (with size, attempts, last error), app data size, free space, notification and permission status.
- **Clear temporary cache** — deletes only the app's *cache* directories and Cache Storage (regenerable images, temporary downloads, web cache).
  **It never touches** the login session, the contact-sync connection/snapshot, the photo upload queue, or any pending data (verified in the UI test and by construction:
  the native plugin only deletes children of `cacheDir`/`externalCacheDir`).
- **Pending uploads:** *Upload now*, *Retry failed*, and per-photo removal (with a warning that it deletes the only copy).
- **Stored photos are not duplicated:** the camera hands the photo to the app as data; the app keeps only the queued copy until the server confirms it.

## 8. Photos, camera, QR and GPS

- **Photos (Field Manager & QC):** *Take photo* (native camera) or *Gallery*; the photo is down-scaled once to 1600 px / JPEG for upload
  (evidence-quality; original is kept in the queue if the upload can't complete), uploaded with progress, and **only reported as saved after the server confirms**.
  A `clientUploadId` makes retries idempotent — three identical simultaneous uploads produce one photo and no orphan in cloud storage (tested).
  Offline / server busy → saved on the phone as *waiting*, uploaded automatically when the connection returns (every minute while the app is open, on resume and on network change).
  A photo the server rejects is marked **Failed** with the reason (not retried forever, not silently dropped). Server validation: type sniffing, size cap, role/job authorisation.
- **QR:** the Android app uses Google's ML Kit code scanner (`@capacitor-mlkit/barcode-scanning`); if it's unavailable it falls back to the web camera scanner.
  The token is sent to the server, which decides whether it matches the job.
- **GPS:** `@capacitor/geolocation` (asks Android's location permission only when a job start needs it). The four start modes
  (**No Verification / Location / QR / QR + Location** — `DIRECT` / `GPS` / `QR` / `GPS_QR`) are unchanged and enforced by the server (`/api/jobs/[id]` arrival checks, `scripts/start-verify.mjs`).

## 9. Push notifications

Firebase Cloud Messaging (HTTP v1) sent **from the server**. Tokens are stored per phone (`MobileDevice.pushToken`), replaced when FCM refreshes
them, cleared when FCM says they're dead, and **move** with the phone if another account signs in on it.

| Event | Who | Opens |
|---|---|---|
| Job assigned / reassigned (removed from the job) | the Field Manager(s) | My jobs / the job |
| Upcoming job reminder (cron) | assigned crew | the job |
| Work completed → QC pending / rework done → reinspection | QC inspectors | the quality check |
| QC found rework | the assigned Field Manager | the job |
| QC passed → customer approval needed | Admin | the job |
| Lead follow-ups due (cron, once a day) | the lead owner | Leads |
| ERP announcement (Admin → `POST /api/push/broadcast`) | chosen roles | home |

- **No sensitive previews:** titles/bodies are generic ("New job assigned. Tap to view it."); **never** a customer name, address, phone, Job ID or amount; lock-screen visibility is *private*.
- **Duplicates:** every event has a de-duplication key in a ledger table (`PushNotification`, unique per user + key); the notification also carries a tag so a repeat replaces the earlier one.
- **Permission is respected:** Android's notification dialog appears only after the user taps *Turn on notifications* and reads the explanation; there is a per-phone switch; denied → no registration.
- **Tap → screen:** the payload carries only an in-app route, checked against an allowlist in the app *and* on the server, and then opened through the normal permission-guarded page (a Field Manager can't be pushed into an Admin page).
- Android 13+ needs the runtime permission; Android 8+ uses the `erp_default` channel (created at start).

## 10. Security and roles

- **Roles unchanged:** Admin, Field Manager, QC, Customer (link, no login), Tax Officer. No new roles. New permissions are mapped onto them:
  `contacts.view/manage/sync` and `media.view/manage`, `notifications.send` → Admin only; `mobile.device` → Admin, Field Manager, QC.
  Every endpoint re-checks on the server; hiding a button is never the guard (tested: Field Manager and QC get 403 on contacts/media; redirected in the UI).
- **Auth storage:** the session is the HttpOnly cookie inside the WebView. The sync token is Android-Keystore-encrypted (AES-256-GCM, key never leaves the Keystore); the comparison snapshot is encrypted too; nothing secret is in `SharedPreferences` in the clear.
- **Network:** HTTPS only (`usesCleartextTraffic=false`, network-security config; debug builds may reach `10.0.2.2`/`localhost`); redirects aren't followed with the token; server enforces HTTPS for device endpoints in production.
- **Backup:** `allowBackup=false` and explicit exclusions — nothing is copied to cloud backup or a new phone.
- **Logout:** ends the server session, clears web storage, stops push for the account, stops its background sync; **does not delete queued photos or unsent state** (the user is told how many photos are waiting and must confirm).
- Server secrets (`FCM_SERVICE_ACCOUNT_JSON`, Cloudinary, DB) are never sent to the app.
- Rate limiting uses an **in-memory** limiter per server instance (fine for a single instance; on a multi-instance/serverless deployment it is per-instance — put a shared limiter in front if you need a hard global limit).

## 11. Updating the app — what needs a new build

Because the app loads the hosted ERP:

| Change | Needs |
|---|---|
| Any page/UI, API, business rule, permission, validation, report, database migration, settings (policy, retention), push *content*, the offline-queue logic and the web side of camera/GPS/QR/contact-sync screens (everything under `src/`) | **Web deploy only.** Users get it on next load. |
| Server secrets / provider changes (Cloudinary, FCM key), cron | server config only |
| Server address (`CAP_SERVER_URL`), app id, name, icons/splash, version | **new APK/AAB** |
| Anything under `android/` — the contact-sync engine, WorkManager schedule, plugins, manifest/permissions, Keystore code, backup rules, `google-services.json` | **new APK/AAB** |
| Adding/upgrading a Capacitor plugin or Android SDK/target version | **new APK/AAB** |
| `targetSdk` bump required by Google Play | **new AAB** |

**Compatibility rule:** a web deploy must keep working with already-installed app versions: the web layer detects plugins at runtime
(missing method → feature disabled, not crash), and the server contact-sync API is versioned by its contract (`SyncBatchRequest`) — extend it additively.
Bump `NEXT_PUBLIC_APP_VERSION` and `versionCode` together when you ship a build; the phone reports its app version on registration.

## 12. Google Play

- **Permissions declaration for `READ_CONTACTS`.** Google restricts sensitive permissions. Play Console → *App content → Sensitive permissions* will ask
  why the app needs contacts. Be truthful: *it is an internal business tool; an Admin chooses to sync the business phone's address book into the company's ERP so staff can recognise customers and follow up enquiries; it is off by default, explained and consented to in-app, pausable and deletable.*
  **There is no guarantee Google approves this** for a public listing. Options if declined: distribute as a **private app via Managed Google Play** (internal/closed testing track or a private enterprise app) or as a directly-installed signed APK, or ship without the contact feature (it is behind an Admin switch; removing `READ_CONTACTS` from the manifest removes it).
- **Data safety form:** contacts (name, phone, email) — collected, shared with the company's own server, encrypted in transit, deletable on request/by Admin; photos; approximate/precise location (job verification); device ids; push token.
- **Privacy policy URL** is required (describe the above, retention, and deletion). Needs a human/legal review — not provided here.
- Declare camera/location as *not required* features (already `required=false`), POST_NOTIFICATIONS, and (when targeting 36) check Play's current target-API and 16 KB page-size requirements.

## 13. Real-device test plan

**Status: NOT YET RUN on a device.** Record results here when done. Use at least one Android 9–11 and one 13–15 phone, a Samsung/Xiaomi (aggressive battery managers) if possible.

*Contact sync* — numbers of contacts: 0, 1, 100, 1 000+. Contacts with: multiple numbers, no name, duplicate numbers, emoji / very long names, international numbers, same number saved twice, number matching an existing customer.
Actions: edit a name, add a number, delete a contact, merge two contacts on the phone. Conditions: permission denied at first, granted later, **revoked while connected**; airplane mode during a run; slow network; **app killed/swiped away** then wait for the scheduled run;
**battery saver / Doze** (leave idle overnight, check *Last successful sync*); phone reboot; logout/login as same user and as a different user; Disconnect (keep / delete); change server data and verify no duplicate customers/leads after repeated syncs.

*Media/camera* — take photo (camera), choose from gallery, large 12–50 MP photos, airplane mode then reconnect, kill app mid-upload, upload failure (server refuses), delete unreferenced / protected / locked media, quota warning, clear device cache while photos are pending.

*App* — login/logout, role redirects, back button (root vs nested), keyboard over forms, rotation, status/navigation bar overlap (edge-to-edge), offline page, deep link from a push, notification permission flows (Android 13+), GPS on/off/denied, QR scan (all four start modes), WebView after app update.

| Date | Device / Android | Tester | Passed | Notes |
|---|---|---|---|---|
| — | — | — | — | not yet run |

## 14. Known limitations

- Not built/run on Android yet (see §2). The first Gradle build may need small fixes; compare against the Capacitor 8 docs if so.
- WorkManager timing is controlled by Android; "about every 6 hours" is a request, not a promise. Some phone makers kill background work unless the user disables battery optimisation for the app (document this for your staff).
- **Edge-to-edge on Android 15+ (targetSdk 36):** the status-bar plugin's "don't overlay" setting may be ignored; check headers/bottom bars on a device and, if needed, add safe-area padding in the web layout (`env(safe-area-inset-*)`).
- Contact identity uses Android's contact id; merging contacts on the phone shows as a removal + update (no duplicate customers/leads).
- Only phone **numbers and emails** from the address book are synced; contacts without a usable number are skipped (counted).
- Rate limiting and the usage cache are per server instance (see §10).
- Cloudinary's Admin API listing used for the cloud scan is capped; very large libraries show "scanned partially".
- Retention periods are sensible defaults, not legal advice.
- The Android build uses the default country code `91`; change `SyncRunner` and `DEFAULT_COUNTRY_CODE` together if needed.
- iOS is out of scope.

## 15. Database migration, API and file map

**Migration:** `prisma/migrations/20261015000000_mobile_contacts_media_push/migration.sql` — additive (new tables `MobileDevice`, `PhoneContact`,
`PhoneContactNumber`, `ContactSyncRun`, `ContactSyncBatch`, `PushNotification`, `MediaDeletion`; `JobPhoto.clientUploadId` with a unique `(jobId, clientUploadId)`;
lead source `PHONE_CONTACT` allowed; `Customer_phone10_idx`). Apply with the normal `npm run db:migrate` (`prisma migrate deploy`).

**API** (all JSON `{success, data|error}`):

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST/PATCH /api/mobile/devices` | session | register phone (+ sync token for Admin), pause/resume, push token, notifications switch |
| `POST /api/mobile/devices/revoke` | session or device token | disconnect (optionally delete contacts) |
| `POST /api/mobile/contacts/sync` | device token | one batch (idempotent) |
| `POST /api/mobile/contacts/failure` | device token | a run that couldn't finish (code only) |
| `GET /api/mobile/contacts/status` | session or device token | Contact Sync screen data |
| `GET /api/contacts`, `/[id]`, `/duplicates`, `/devices`; `POST /api/contacts/import-leads`; `DELETE /api/contacts` | Admin | directory, review, import, purge |
| `GET /api/media`, `/summary`, `/unreferenced`; `POST /api/media/delete` | Admin | Media & Storage |
| `POST /api/push/test`, `POST /api/push/broadcast` | session / Admin | push |
| `GET|POST /api/cron/maintenance` | `CRON_SECRET` | reminders, follow-ups, retention |

**Where things are:** server `src/lib/server/{devices,contact-sync,contacts-directory,media,media-provider,push,maintenance}.ts`, shared rules `src/lib/{phone,contacts,contact-clean,media,media-policy,push-messages}.ts`;
web `src/app/{contacts,media,device-storage}`, `src/lib/mobile/*`, `src/components/mobile/*`; native `android/app/src/main/java/com/intensecare/erp/` (`sync/` = pure-Java engine, `sync/android/` = Android glue: reader, Keystore, WorkManager, `ContactSyncPlugin`, `DeviceStoragePlugin`);
tests `tests/mobile.test.ts`, `tests/upload-queue.test.ts`, `android/app/src/test/…`, `scripts/mobile-verify.mjs`, `scripts/mobile-ui-verify.mjs`, `scripts/fake-providers.mjs`.

**Re-running the checks** (fresh database, server started with the fake providers):

```bash
node scripts/fake-providers.mjs &                              # :3998 http, :3997 https (self-signed)
# server env: CLOUDINARY_CLOUD_NAME=test CLOUDINARY_API_KEY=k CLOUDINARY_API_SECRET=s \
#   CLOUDINARY_UPLOAD_PREFIX=https://localhost:3997/cloud NODE_TLS_REJECT_UNAUTHORIZED=0 \
#   FCM_API_BASE=http://localhost:3998/fcm FCM_TOKEN_URL=http://localhost:3998/fcm/token \
#   FCM_SERVICE_ACCOUNT_JSON='{"project_id":"test-proj","client_email":"t@x","private_key":"<any RSA key>"}' CRON_SECRET=cron-secret
BASE_URL=http://localhost:3100 node scripts/mobile-verify.mjs      # 118 checks
BASE_URL=http://localhost:3100 node scripts/mobile-ui-verify.mjs   # 60 checks (needs Playwright + Chromium)
npm test                                                           # unit tests incl. mobile + upload queue
# Java core (no Android SDK needed): JUnit 4.13 + org.json on the classpath
cd android/app && javac -d /tmp/out -cp junit.jar:hamcrest-core.jar:json.jar src/main/java/com/intensecare/erp/sync/*.java src/test/java/com/intensecare/erp/sync/*.java \
  && java -cp /tmp/out:junit.jar:hamcrest-core.jar:json.jar org.junit.runner.JUnitCore com.intensecare.erp.sync.SyncEngineTest …
```
