# Customer photos, property map links and UPI payment

What changed, how it works, how it was tested — and what is **not** proven. Read §5 (limitations) before relying on UPI in production.

## 1. Before / after photos in the customer portal

**What was wrong (found by reading the code and by actually requesting images — the existing tests only ever checked that wrong requests return 404; none fetched a photo successfully):**

| # | Finding | Effect for the customer |
|---|---|---|
| 1 | The page showed only the **first** photo per room and type (`find`) in a small non-clickable grid. There was no viewer. "View before / after" just switched to that grid. | Extra photos invisible; nothing could be opened full size, zoomed or stepped through. |
| 2 | Images are streamed through `/api/secure-photo/<id>?t=<link>` from the provider's **public** delivery URL with no fallback. | On a Cloudinary account with restricted/strict-transformation or authenticated media the provider answers 401/404 → the route returned 502 → blank images. |
| 3 | No thumbnails: phones downloaded the full 1600 px photo for every tile; the route allowed 120 images/min per IP, so a gallery behind one mobile-carrier IP could be rate-limited. | Slow or partly blank galleries. |
| 4 | Staff screens linked straight to storage URLs. | Would break the same way on private storage; storage identifiers were sent to browsers. |
| 5 | (checked, no fault) Job ↔ customer relationship, DB fields, API payload, visibility flags, QC photos excluded. | — |

I could **not** reproduce your live failure against your real Cloudinary account (no access). The data path is correct in every test; #1 and #2 are the defects that explain "View doesn't work". If images still fail in production, open `/api/secure-photo/<photo id>?t=<customer link token>` in a browser: **502** means the provider refused the server (check Cloudinary → Settings → Security → "Restricted media types" / strict transformations; the signed fallback below handles these), **404** means the link is revoked/wrong or visibility hides that photo.

**Fix**
- `PhotoGallery` (`src/components/common/PhotoGallery.tsx`): photos grouped **Before photos / After photos**, thumbnail grid (3–4 per row on a phone), room name and upload date under each, captions in the viewer. Tapping opens a full-screen viewer: **zoom** (buttons, pinch, double-tap, mouse wheel, keys + − 0), **previous / next** (buttons, swipe, ← →), **close** (button, Esc), "n of N" counter, load error with **Try again**. Thumbnails that fail say "Tap to retry".
- Server (`src/lib/server/photo-delivery.ts`): the ERP fetches the image, and if the provider refuses the plain URL it generates a **signed** delivery URL on the server and tries that (thumbnails are signed transformations). Only `image/*` responses are passed on (never a provider error page). Storage URLs and secrets never reach the browser. Cached privately for 5 minutes, `nosniff`.
- Access is unchanged and re-tested: a link reads only its own job's before/after photos; QC / rework photos are never served on the customer link; photos the Admin hid (job or company visibility settings) are omitted from the payload and refused if requested directly; revoked links stop serving.
- Staff: `/api/photos` now returns ERP image routes (`/api/photos/<id>/image[?s=thumb]`, session + job-scope checked) instead of storage URLs and no longer returns storage identifiers; the Admin job page uses the same gallery (including QC / rework groups).

## 2. Property: paste a map link → Extract Location

Where: the location block of **Add / Edit property** (and the job form's location picker): *Google Maps link / location link* + **[Extract Location]**.

Flow: paste → Extract → the server reads the link → the map pin moves and latitude/longitude fill in (**not saved yet**) → the address at the pin is offered ("Use this address") → drag the pin or type coordinates to adjust → **Save**. The link, final coordinates, address and source (`MAP_LINK`, or `MANUAL` if adjusted) are stored on the property; open jobs follow the property's pin (existing rule), as do Field Manager navigation, GPS start checks and the customer portal.

| Link | Result |
|---|---|
| `…/maps/place/…/data=…!3d<lat>!4d<lng>` | **Exact** — the place's own point |
| `?q=lat,lng`, `query=`, `ll=`, `destination=`, `/maps/search/lat,lng`, `/maps/place/lat,lng`, OSM `mlat/mlon`, Apple `ll=`, `geo:` | **Exact** |
| `…/@lat,lng,17z` | **Approximate** — the centre of the map view, which can be off the building; the Admin is told to check/drag the pin |
| Short links (`maps.app.goo.gl`, `goo.gl/maps`, `g.co`) | Redirects are followed **on the server** (https, Google hosts only, ≤ 5 hops, no body read, no internal addresses) and the final URL is read as above |
| Place **name** with no coordinates (long or short link) | Looked up by address search → **Approximate**, "best guess" warning, up to 2 alternatives to choose from |
| Not a link / other website / dead or looping short link / nothing readable | Clear message; **the current location is not touched**; place the pin by hand |

Safeguards: latitude −90…90, longitude −180…180, never (0,0); coordinates outside India or that look swapped are flagged; half a pair or (0,0) is refused by the API; saving without new coordinates never clears or overwrites a valid saved pin (only an explicit "remove pin" does); a non-web `mapLink` (`javascript:` etc.) is refused; no API key is used or sent to the browser; endpoint needs a property/job-creating role and is rate limited.

## 3. UPI payment (optional, never blocks the job)

**Admin → Settings → UPI payment:** enable switch, business UPI ID (VPA), payee name, optional description. Nothing is hard-coded; the form says exactly what is missing; the server refuses to enable an incomplete or invalid configuration and **audit-logs every change of the payee account** (masked).

**Customer (invoice page on their secure link → Payment):** shows invoice number, Job ID, total, already paid, **outstanding**, method, status. **Pay now** → the server creates (or reuses) a payment request for the invoice's **outstanding balance** (the browser sends no amount and cannot change `pa`/`am`) and returns a standard link `upi://pay?pa=&pn=&am=&cu=INR&tn=&tr=` (values percent-encoded; note = description + invoice number; `tr` = unique reference). On a phone the system opens its UPI chooser (Google Pay, PhonePe, Paytm, BHIM …); in the Android app the link is handed to the system the same way. If no app takes the link within ~2.5 s the page shows a **QR code** to scan from another phone and a **copy UPI ID** button. Coming back to the page **assumes nothing**: it asks for the **UTR** from the UPI app.

**Statuses** (separate from the invoice's ledger status and from the job's status):

| Shown | Meaning |
|---|---|
| `UNPAID` | nothing started or settled |
| `PAYMENT_INITIATED` | customer tapped Pay now (stops counting after 2 h) — **nothing is paid** |
| `PAYMENT_REVIEW_REQUIRED` | customer submitted a UTR; waiting for an Admin |
| `PAID` | **only** after an Admin confirmed and the invoice balance reached 0 |
| `PARTIALLY_PAID` | Admin confirmed less than the total; customer can pay the rest |
| `FAILED` | an Admin rejected the claim ("not received") — with a reason the customer sees |

**Admin:** a banner on *Invoices* lists payments waiting to be checked; the invoice page has *Customer UPI payments* — shows UTR, amount, history; **Confirm received** (amount received — can be less for a part payment — and the bank's UTR) records the payment once, row-locked, through the same routine as *Record payment*; **Not received** (reason) rejects. Verifying twice or from two admins at once records one payment. Overpaying is refused. Offline payments (cash / bank / UPI recorded by Admin) work as before and are now race-safe too.

**Duplicates & audit:** double-tapping Pay now reuses one request; one live request awaiting review per invoice; a UTR can be used once across all invoices (DB unique index + payment ledger check); every status change is stored (`UpiPaymentEvent`) and the key actions are in the audit log. **No UPI PINs, passwords or card data are ever requested or stored** — only the UTR the customer chooses to type.

**GST / Non-GST:** payments apply to the invoice's existing totals; nothing about tax calculation changed. Tax Officers cannot list or verify payments.

## 4. Payment never blocks completion
Job flow is unchanged: … → QC passed → customer approval → **Completed** → invoice/payment. Nothing in the job state machine reads payment (verified: a job was driven to COMPLETED with an unpaid invoice, UPI never opened, no reference; the customer can still rate it; switching UPI off never changes a job). Unpaid invoices stay in the invoice list; the customer can pay later from the portal; Admin can record verified offline payments at any time.

## 5. Tests and limitations

| Suite | Result |
|---|---|
| `scripts/portal-verify.mjs` (real server + PostgreSQL; fake storage / short links / geocoder) | **158 checks pass** — photos (grouping, thumbnails, private-storage signed fallback, outage → 502, visibility, revoked link, cross-customer, each staff role), map links (every format in §2, failures, SSRF-style redirects, saving rules, consistency with jobs / portal / GPS), UPI (settings, configured / not configured, link contents, duplicates, concurrency, part payment, reject, roles, audit trail), job completes without payment |
| `scripts/portal-ui-verify.mjs` (Chromium, 390 px) | **55 checks pass** — gallery grouping / viewer / zoom / navigation / error + retry, no horizontal scroll, Admin gallery, property Extract flow (failure keeps location, success fills fields, manual adjust, save), Pay now → fallback → UTR → "being checked" → Admin confirms → customer sees paid |
| `tests/map-link.test.ts`, `tests/payments.test.ts` | 19 unit tests (URL formats, encoding, injection, statuses) |
| Existing suites (`npm test`, e2e, erp, biz, start, location, lead, ai, mobile-verify, mobile-ui-verify) | all pass; one outdated assertion fixed earlier (`biz-verify` expense delete) |

Run each browser/API suite on a **fresh database** (they create fixtures).

**Not tested / limitations — please read**
- **No real UPI app, phone or bank was used.** The UPI link is built to the NPCI deep-link format and its contents are verified, but what Google Pay / PhonePe / Paytm do with it depends on the app and the account type. In particular **Google Pay and others may refuse or limit payments to a *personal* UPI ID with a pre-filled amount** ("can't process / limit exceeded"). Use a **merchant / business VPA**, and do a ₹1 test on the Android and iPhone devices your customers use before announcing it.
- "Choose Google Pay or another app" is the **operating system's chooser**; the page cannot see which apps are installed. "Return to the ERP" depends on the app; the page cannot know if payment succeeded and says so.
- **No automatic confirmation.** A payment is real only when an Admin confirms it against the bank. Automatic verification needs a payment gateway / bank API (not built).
- Short links and place-name lookups were tested against **local fakes** of Google and OpenStreetMap, not the live services. Google can change link formats; unreadable links fail safely. The default address search (Nominatim) has a usage policy and no SLA — set `GEOCODE_URL` for a paid provider if you use this heavily.
- Photo "private storage" behaviour was verified with a fake private delivery domain, not with your real Cloudinary account.
- QC inspectors can read photos of any job (existing role scope, unchanged); Field Managers only their own jobs.
- The customer payment screen needs the invoice to be visible to the customer (visibility setting) — by design.
- The headless-browser test cannot follow a `upi:` link; the app hand-off was verified only up to the point where the link is produced.

**Migration:** `20261020000000_property_map_link_upi_payments` (additive: `Property.mapLink`, `UpiPaymentAttempt`, `UpiPaymentEvent`). **New dependency:** `qrcode` (fallback QR). **Env:** `GEOCODE_URL`, `CLOUDINARY_DELIVERY_HOST` optional (see `.env.example`).
