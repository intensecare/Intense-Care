# WhatsApp Business Cloud API (official Meta integration)

The ERP talks to WhatsApp only through Meta's **WhatsApp Business Platform Cloud API**. No WhatsApp Web automation,
OpenWA or other unofficial library is used anywhere.

## What it does
* **Receives** customer messages (text, images, documents, audio, video, stickers, locations, button/list replies) on a public
  HTTPS webhook, verifies Meta's signature, and files each message under the right lead.
* **Creates a lead** (source `WHATSAPP`, status `NEW`) for a number we have no open lead for; otherwise **appends** to that lead's
  conversation. Matching uses the same last-10-digit rule as the rest of Lead Management. An existing lead's name, status,
  source and details are never overwritten.
* **WhatsApp inbox** (Leads → WhatsApp inbox): search, unread / unassigned / mine filters, photo & document previews, sent →
  delivered → read ticks, assignment, opt-out and consent controls, reply box, template picker.
* **Replies from the ERP** through the Cloud API, tracked per message from Meta's status webhooks.
* **Notifications** to staff (own push ledger rows, independent of WhatsApp): new enquiry, new message on a lead.
  Job-related customer messages (existing feature) now go through the same sender, honour opt-outs and are tracked.
* **Admin page** (Settings → WhatsApp): credential status (set / not set only), IDs, callback URL, Test connection, template sync,
  health counters and actionable problem list.

## Setup (Meta side)
1. Create / use a **Meta Business Portfolio** (business.facebook.com) and complete Business Verification (needed for production limits).
2. In **Meta for Developers** create an app (type *Business*) and add the **WhatsApp** product.
3. Create / pick the **WhatsApp Business Account (WABA)** and **register your phone number** (WhatsApp Manager → Phone numbers).
   Note the **Phone Number ID** and **WABA ID** (WhatsApp → API setup).
4. Create a **System User** (Business settings → Users → System users), assign it the WABA + the app, and generate a token with the
   permissions `whatsapp_business_messaging` and `whatsapp_business_management`. Choose *Never expire*. The temporary 24-hour token
   from API setup is for experiments only.
5. Copy the app's **App Secret** (App settings → Basic).
6. Set the server environment (see below) and deploy over **HTTPS**.
7. In the app's **WhatsApp → Configuration**: Callback URL = `https://<your-domain>/api/webhooks/whatsapp`, Verify token = the value of
   `WHATSAPP_WEBHOOK_VERIFY_TOKEN`; click *Verify and save*, then subscribe to the **`messages`** field (it carries incoming messages
   *and* delivery statuses). In the app's WABA subscription also make sure your app is subscribed (`POST /<WABA_ID>/subscribed_apps`).
8. Create message templates in WhatsApp Manager; after Meta approves them click **Sync templates** in Settings → WhatsApp.

## Server environment (secrets live ONLY here — never in the database, browser, mobile app or logs)
| Variable | Purpose |
|---|---|
| `WHATSAPP_ACCESS_TOKEN` | system-user token (sending, media download, test connection) |
| `WHATSAPP_APP_SECRET` | verifies `X-Hub-Signature-256` on every webhook post |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | answers Meta's callback verification |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID` | optional defaults; an Admin can also enter them in Settings → WhatsApp |
| `WHATSAPP_GRAPH_VERSION` | optional, default `v21.0` |
| `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANGUAGE` | template used for automatic customer notifications (job updates); the message text is its `{{1}}` |
| `CRON_SECRET` | the scheduler that calls `/api/cron/maintenance` (also retries failed WhatsApp events and media) |
| `APP_BASE_URL` | public https address shown as the callback URL |
(`WHATSAPP_GRAPH_BASE` exists only so the test suite can point at a stand-in Graph API.)

Rotate a token by changing the environment variable and redeploying; nothing else changes.

## How a webhook is handled
1. `GET` — answers Meta's challenge only when `hub.verify_token` matches (constant-time compare).
2. `POST` — body ≤ 1 MB; `X-Hub-Signature-256` (HMAC-SHA256 of the **raw** body with the app secret) is checked **before** parsing;
   anything else → 401, nothing stored.
3. The payload is parsed defensively. Skipped (counted, not stored): group messages, our own number's echoes, reactions, system
   notices, other `object`/`field` values, events for another phone-number ID, malformed entries.
4. Each remaining event is written once to `WhatsAppEvent` (unique key = message id, or message id + status) — Meta's retries are no-ops.
   We answer `200` as soon as the events are stored (processing is awaited for at most 4 s so the common case is finished first).
   If storing fails we answer `503` so Meta retries.
5. Processing is idempotent: a transaction holding a per-phone advisory lock finds/creates the lead and stores the message, so five
   simultaneous first messages still make **one** lead. Failures are retried by `/api/cron/maintenance` (12 attempts). A delivery
   status that arrives before our own send is stored simply waits and is applied on the next run.
6. Attachments are downloaded by a second step: Graph media lookup → HTTPS download from an allow-listed Meta host (the token is sent
   nowhere else) → size cap 16 MB → SHA-256 must equal Meta's → declared type must be on the allow-list and, for images/PDF, the
   real bytes must match. Anything failing is **not stored** (the message and a note still appear). Stored files are served only by
   `/api/whatsapp/media/<id>` to signed-in staff with `leads.view`, with `nosniff` and a sandboxing CSP.

## Sending rules
* Free text only while the **24-hour customer-service window** is open (it restarts with every customer message). Afterwards only an
  **approved template**.
* **Opt-out**: a customer writing STOP / UNSUBSCRIBE / CANCEL / END / QUIT / OPT OUT is opted out (START restores). Nothing — text,
  template or automatic notification — is sent to an opted-out number. An Admin can also record an opt-out.
* **Marketing** templates are refused unless consent was recorded on the conversation. No bulk or unsolicited sending exists.
* A message is `PENDING` → `ACCEPTED` (Meta took the request — **not** delivered) → `SENT` → `DELIVERED` → `READ`, or `FAILED`, each step
  only when Meta's status webhook says so. Late or out-of-order statuses never move a message backwards.
* A double-click or retry of the same request (`clientRequestId`) is one message.
* Provider errors are mapped to actions: expired/revoked token (190) → 503 + banner on the integration page; rate limits → 429 with
  `Retry-After`; closed window (131047) → "send a template"; undeliverable number; template mismatch; unregistered number; outages → 502.
  A timed-out request is **not** retried automatically (it might already have been sent).

## Access
Reading the inbox needs `leads.view`; replying, assigning and consent need `leads.manage`; the integration page needs
`integrations.manage` (Admin). Field Operations Managers and Tax Officers cannot read or send. Every conversation endpoint is scoped
to one customer's messages.

## Audit log
`LEAD_CREATED_FROM_WHATSAPP`, `WHATSAPP_MESSAGE_SENT`, `WHATSAPP_SEND_FAILED`, `WHATSAPP_OPT_OUT`/`_IN`, `WHATSAPP_CONSENT_CHANGED`,
`WHATSAPP_SETTINGS_CHANGED`, `WHATSAPP_CONNECTION_TESTED`, `WHATSAPP_TEMPLATES_SYNCED`, `LEAD_ASSIGNED`. Logs never contain tokens,
secrets, full phone numbers or message text.

## Cost and policy notes (check Meta's current pricing page — it changes)
* Meta bills per **delivered template message** by category (marketing, utility, authentication), by recipient country, and may add
  tax (e.g. GST) via your reseller / billing setup. Service (free-form) replies inside the 24-hour window are not charged per message.
* Template content and category are reviewed by Meta; marketing templates need opt-in. Quality rating and messaging-tier limits apply
  (the Settings page shows the quality rating returned by Meta).
* Any BSP/provider you use may add its own fees on top of Meta's.

## Testing
* `npm test` — pure parsing / window / status-order / consent / media / error-classification tests (`tests/whatsapp.test.ts`).
* `scripts/whatsapp-verify.mjs` — the real server and database, Meta's webhook payloads signed exactly like Meta signs them,
  and a stand-in Graph API (`scripts/fake-providers.mjs`): challenge, signatures, lead creation / append / no-duplicate / concurrency,
  ignored events, media safety, sending, status tracking, 24-hour window, templates, opt-out, provider errors, access control, secrets, logs.
* `scripts/whatsapp-ui-verify.mjs` — browser checks of the inbox and Settings → WhatsApp.
* **These do not replace a live test.** No real WhatsApp message was sent in the automated runs.

### Live acceptance test (do this on staging before go-live)
1. Test connection in Settings → WhatsApp → “Connected to <your verified name>”.
2. From a personal phone send “hello” to the business number. Within seconds a lead `LD-…` (source WhatsApp, status New) must appear and
   the message must show in Leads → WhatsApp inbox, unread 1, with the right name/number.
3. Send a second message and a photo from the same phone: no new lead; both appear in the same conversation; the photo previews.
4. Reply from the ERP. The tick shows *Accepted*, then *Sent / Delivered / Read* as the phone receives and opens it.
5. Wait 24 h (or temporarily test with a number whose window is closed): free text is refused, a template works.
6. Send STOP: the conversation shows “Opted out” and replies are blocked.
7. Replace the token with a wrong one: Test connection shows an actionable error.

## Not included
Outgoing images/documents, WhatsApp Flows, click-to-WhatsApp ad attribution, group chats, multiple business numbers.
