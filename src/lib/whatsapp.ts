/**
 * WhatsApp Business Cloud API — pure helpers (no database, no network): webhook payload parsing,
 * delivery-status ordering, the 24-hour customer-service window and the send rules.
 * Everything that comes from Meta is treated as untrusted input and validated here.
 */

export const WINDOW_MS = 24 * 60 * 60 * 1000;

export type OutStatus = "PENDING" | "ACCEPTED" | "SENT" | "DELIVERED" | "READ" | "FAILED";
const RANK: Record<string, number> = { PENDING: 0, ACCEPTED: 1, SENT: 2, DELIVERED: 3, READ: 4 };

/** Meta's status word → ours. "accepted" is what WE record when the API call returns; it is not delivery. */
export function statusFromMeta(s: unknown): OutStatus | null {
  switch (s) {
    case "sent": return "SENT";
    case "delivered": return "DELIVERED";
    case "read": return "READ";
    case "failed": return "FAILED";
    default: return null;
  }
}

/** Statuses can arrive out of order (read before delivered). A status only ever moves forward; FAILED wins only before delivery. */
export function nextStatus(current: string, incoming: OutStatus): string {
  if (incoming === "FAILED") return current === "DELIVERED" || current === "READ" ? current : "FAILED";
  if (current === "FAILED") return RANK[incoming] >= RANK.SENT ? incoming : current; // a late "sent" after a failure we recorded early
  return (RANK[incoming] ?? -1) > (RANK[current] ?? -1) ? incoming : current;
}

export const windowOpen = (lastInboundAt: Date | string | null | undefined, now = Date.now()): boolean =>
  !!lastInboundAt && now - new Date(lastInboundAt).getTime() < WINDOW_MS;

export const windowClosesAt = (lastInboundAt: Date | string | null | undefined): string | null =>
  lastInboundAt ? new Date(new Date(lastInboundAt).getTime() + WINDOW_MS).toISOString() : null;

/* ------------------------------------------------------------------ opt-out */

const STOP = /^\s*(stop|stop all|unsubscribe|cancel|end|quit|opt[\s-]?out)\s*[.!]*\s*$/i;
const START = /^\s*(start|subscribe|unstop|opt[\s-]?in)\s*[.!]*\s*$/i;
/** A customer's message that withdraws (or restores) permission to be messaged. */
export function optIntent(text: string | null | undefined): "OUT" | "IN" | null {
  if (!text) return null;
  if (STOP.test(text)) return "OUT";
  if (START.test(text)) return "IN";
  return null;
}

/* ------------------------------------------------------------------ send rules */

export interface SendContext {
  configured: boolean;
  optedOut: boolean;
  lastInboundAt: Date | string | null | undefined;
  marketingConsent: boolean;
  now?: number;
}
export type Block = { code: "NOT_CONFIGURED" | "OPTED_OUT" | "WINDOW_CLOSED" | "NO_CONSENT" | "TEMPLATE_NOT_APPROVED"; message: string };

export function canSendText(c: SendContext): Block | null {
  if (!c.configured) return { code: "NOT_CONFIGURED", message: "WhatsApp is not connected. An Admin must finish the setup in Settings → WhatsApp." };
  if (c.optedOut) return { code: "OPTED_OUT", message: "This customer opted out of WhatsApp messages. Nothing can be sent to them." };
  if (!windowOpen(c.lastInboundAt, c.now)) return { code: "WINDOW_CLOSED", message: "The 24-hour reply window is closed. WhatsApp only allows an approved template message now." };
  return null;
}

export function canSendTemplate(c: SendContext, t: { status: string; active: boolean; category: string }): Block | null {
  if (!c.configured) return { code: "NOT_CONFIGURED", message: "WhatsApp is not connected. An Admin must finish the setup in Settings → WhatsApp." };
  if (c.optedOut) return { code: "OPTED_OUT", message: "This customer opted out of WhatsApp messages. Nothing can be sent to them." };
  if (t.status !== "APPROVED" || !t.active) return { code: "TEMPLATE_NOT_APPROVED", message: "That template is not approved by Meta (or is switched off here)." };
  if (t.category === "MARKETING" && !c.marketingConsent) return { code: "NO_CONSENT", message: "Marketing templates need the customer's recorded consent. Record it on the conversation first." };
  return null;
}

/* ------------------------------------------------------------------ webhook parsing */

export interface InboundMessage {
  kind: "MESSAGE";
  id: string;
  from: string; // wa_id digits
  profileName: string | null;
  timestamp: Date;
  type: string; // normalised, see TYPES
  text: string | null;
  mediaId: string | null;
  mediaMime: string | null;
  filename: string | null;
  phoneNumberId: string | null;
}
export interface StatusUpdate {
  kind: "STATUS";
  id: string; // wamid of OUR message
  status: OutStatus;
  recipient: string;
  timestamp: Date;
  errorCode: string | null;
  errorMessage: string | null;
  phoneNumberId: string | null;
}
export type WaEvent = InboundMessage | StatusUpdate;

export interface ParseResult {
  events: WaEvent[];
  /** Counted, never stored: groups, our own echoes, reactions, system notices, unrelated fields. */
  ignored: number;
}

const MEDIA_TYPES = ["image", "document", "audio", "video", "sticker"] as const;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 4000): string | null => (typeof v === "string" && v.length ? v.slice(0, max) : null);
const digits = (v: unknown): string | null => {
  const d = typeof v === "string" ? v.replace(/\D/g, "") : "";
  return d.length >= 7 && d.length <= 15 ? d : null;
};
const when = (v: unknown): Date => {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  const d = Number.isFinite(n) && n > 1e9 && n < 4e9 ? new Date(n * 1000) : new Date();
  return d;
};

/**
 * Extracts messages and delivery statuses from a Meta webhook body. Anything that is not an
 * individual customer's message to US (groups, echoes of our own messages, reactions, system
 * notices, other fields) is skipped. `ownNumberId`, when known, drops events for any other number.
 */
export function parseWebhook(body: unknown, opts: { ownNumberId?: string | null } = {}): ParseResult {
  const out: ParseResult = { events: [], ignored: 0 };
  if (!isObj(body) || body.object !== "whatsapp_business_account" || !Array.isArray(body.entry)) return out;
  for (const entry of body.entry) {
    if (!isObj(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isObj(change) || change.field !== "messages" || !isObj(change.value)) { out.ignored++; continue; }
      const v = change.value;
      const meta = isObj(v.metadata) ? v.metadata : {};
      const pnid = str(meta.phone_number_id, 40);
      const ownDisplay = digits(meta.display_phone_number);
      if (opts.ownNumberId && pnid && pnid !== opts.ownNumberId) { out.ignored++; continue; }
      const names = new Map<string, string>();
      for (const c of Array.isArray(v.contacts) ? v.contacts : []) {
        if (isObj(c)) { const w = digits(c.wa_id); const n = isObj(c.profile) ? str(c.profile.name, 120) : null; if (w && n) names.set(w, n.trim()); }
      }
      for (const m of Array.isArray(v.messages) ? v.messages : []) {
        const parsed = parseMessage(m, names, pnid, ownDisplay);
        if (parsed) out.events.push(parsed); else out.ignored++;
      }
      for (const s of Array.isArray(v.statuses) ? v.statuses : []) {
        const parsed = parseStatus(s, pnid);
        if (parsed) out.events.push(parsed); else out.ignored++;
      }
    }
  }
  return out;
}

function parseMessage(m: unknown, names: Map<string, string>, pnid: string | null, ownDisplay: string | null): InboundMessage | null {
  if (!isObj(m)) return null;
  const id = str(m.id, 200);
  const from = digits(m.from);
  const type = str(m.type, 30);
  if (!id || !from || !type) return null;
  if (m.group_id !== undefined || (isObj(m.context) && m.context.group_id !== undefined)) return null; // group chats
  if (ownDisplay && from === ownDisplay) return null; // our own number echoed back
  if (type === "reaction" || type === "system" || type === "errors" || type === "ephemeral") return null;
  const base = { kind: "MESSAGE" as const, id, from, profileName: names.get(from) ?? null, timestamp: when(m.timestamp), phoneNumberId: pnid, text: null as string | null, mediaId: null as string | null, mediaMime: null as string | null, filename: null as string | null };
  if (type === "text") return { ...base, type: "text", text: isObj(m.text) ? str(m.text.body, 4096) : null };
  if ((MEDIA_TYPES as readonly string[]).includes(type)) {
    const o = isObj(m[type]) ? (m[type] as Record<string, unknown>) : {};
    return { ...base, type, text: str(o.caption, 1024), mediaId: str(o.id, 200), mediaMime: str(o.mime_type, 100), filename: str(o.filename, 200) };
  }
  if (type === "button") return { ...base, type: "button", text: isObj(m.button) ? str(m.button.text, 500) ?? "[button]" : "[button]" };
  if (type === "interactive") {
    const i = isObj(m.interactive) ? m.interactive : {};
    const r = isObj(i.button_reply) ? i.button_reply : isObj(i.list_reply) ? i.list_reply : {};
    return { ...base, type: "interactive", text: str(r.title, 500) ?? "[interactive reply]" };
  }
  if (type === "location") {
    const l = isObj(m.location) ? m.location : {};
    const label = [str(l.name, 200), str(l.address, 300)].filter(Boolean).join(", ") || `${Number(l.latitude)},${Number(l.longitude)}`;
    return { ...base, type: "location", text: `[location] ${label}` };
  }
  if (type === "contacts") return { ...base, type: "contacts", text: "[shared contact]" };
  return { ...base, type: "unsupported", text: `[${type.replace(/[^a-z_]/g, "")} message — open WhatsApp Business to view]` };
}

function parseStatus(s: unknown, pnid: string | null): StatusUpdate | null {
  if (!isObj(s)) return null;
  const id = str(s.id, 200);
  const status = statusFromMeta(s.status);
  const recipient = digits(s.recipient_id);
  if (!id || !status || !recipient) return null;
  if (s.recipient_type === "group" || s.group_id !== undefined) return null;
  const err = Array.isArray(s.errors) && isObj(s.errors[0]) ? (s.errors[0] as Record<string, unknown>) : null;
  const data = err && isObj(err.error_data) ? err.error_data : null;
  return {
    kind: "STATUS", id, status, recipient, timestamp: when(s.timestamp), phoneNumberId: pnid,
    errorCode: err ? String(err.code ?? "") || null : null,
    errorMessage: err ? (str(data?.details, 300) ?? str(err.message, 300) ?? str(err.title, 300)) : null,
  };
}

export const eventKey = (e: WaEvent): string => (e.kind === "MESSAGE" ? `message:${e.id}` : `status:${e.id}:${e.status}`);

/* ------------------------------------------------------------------ media */

/** What we accept to store from a customer. Anything else is recorded as "not stored" (the message text still appears). */
export const MEDIA_ALLOWED: Record<string, { ext: string; inline: boolean }> = {
  "image/jpeg": { ext: "jpg", inline: true },
  "image/png": { ext: "png", inline: true },
  "image/webp": { ext: "webp", inline: true },
  "application/pdf": { ext: "pdf", inline: true },
  "audio/ogg": { ext: "ogg", inline: false },
  "audio/mpeg": { ext: "mp3", inline: false },
  "audio/mp4": { ext: "m4a", inline: false },
  "audio/aac": { ext: "aac", inline: false },
  "audio/amr": { ext: "amr", inline: false },
  "video/mp4": { ext: "mp4", inline: false },
  "video/3gpp": { ext: "3gp", inline: false },
  "text/plain": { ext: "txt", inline: false },
  "application/msword": { ext: "doc", inline: false },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: "docx", inline: false },
  "application/vnd.ms-excel": { ext: "xls", inline: false },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { ext: "xlsx", inline: false },
};
export const MEDIA_MAX_BYTES = 16 * 1024 * 1024;

/** The file's real format from its first bytes, for the formats where that can be checked. */
export function sniffMime(b: Uint8Array): string | null {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (b.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (b.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (b.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  if (b.length >= 5 && at(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf";
  return null;
}

/** Accept the download only if its type is allowed and, for images/PDF, its bytes really are that type. */
export function checkMedia(declaredMime: string | null, bytes: Uint8Array): { ok: true; mime: string } | { ok: false; reason: string } {
  const mime = (declaredMime ?? "").split(";")[0].trim().toLowerCase();
  if (!MEDIA_ALLOWED[mime]) return { ok: false, reason: `File type ${mime || "unknown"} is not stored.` };
  if (bytes.length === 0) return { ok: false, reason: "Empty file." };
  if (bytes.length > MEDIA_MAX_BYTES) return { ok: false, reason: "File is larger than 16 MB and was not stored." };
  const real = sniffMime(bytes);
  if ((mime.startsWith("image/") || mime === "application/pdf") && real !== mime) return { ok: false, reason: "File content does not match its declared type." };
  return { ok: true, mime };
}

/* ------------------------------------------------------------------ Meta API errors */

export type ApiFailure = { code: string; kind: "TOKEN" | "RATE_LIMIT" | "WINDOW" | "RECIPIENT" | "TEMPLATE" | "NUMBER" | "TRANSIENT" | "OTHER"; message: string; retryable: boolean };

/** Meta error codes → what the operator should do about it. */
export function classifyApiError(httpStatus: number, error: { code?: number; error_subcode?: number; message?: string } | null | undefined): ApiFailure {
  const code = error?.code ?? 0;
  const c = String(code || httpStatus);
  if (httpStatus === 401 || code === 190 || code === 102) return { code: c, kind: "TOKEN", retryable: false, message: "WhatsApp rejected the access token (expired or revoked). An Admin must replace WHATSAPP_ACCESS_TOKEN with a fresh system-user token." };
  if (code === 10 || code === 200 || code === 299) return { code: c, kind: "TOKEN", retryable: false, message: "The access token lacks a required permission (whatsapp_business_messaging / whatsapp_business_management)." };
  if (httpStatus === 429 || [4, 17, 32, 613, 80007, 130429, 131048, 131056].includes(code)) return { code: c, kind: "RATE_LIMIT", retryable: true, message: "WhatsApp is rate-limiting this number. Wait a minute and try again." };
  if (code === 131047) return { code: c, kind: "WINDOW", retryable: false, message: "The 24-hour reply window is closed. Send an approved template instead." };
  if (code === 131026 || code === 131021) return { code: c, kind: "RECIPIENT", retryable: false, message: "WhatsApp could not deliver to this number (not on WhatsApp, or blocked / not reachable)." };
  if (code === 131030) return { code: c, kind: "RECIPIENT", retryable: false, message: "This number is not on the allowed recipient list (the account is still in test mode)." };
  if (code === 131009 || code === 132000 || code === 132001 || code === 132005 || code === 132007 || code === 132012 || code === 132015 || code === 132016) return { code: c, kind: "TEMPLATE", retryable: false, message: "WhatsApp rejected the template (name, language or parameters do not match the approved template)." };
  if (code === 133010 || code === 133004 || code === 133005 || code === 133006) return { code: c, kind: "NUMBER", retryable: false, message: "The business phone number is not registered or is disconnected in WhatsApp Manager." };
  if (httpStatus >= 500 || code === 1 || code === 2 || code === 131000) return { code: c, kind: "TRANSIENT", retryable: true, message: "WhatsApp had a temporary problem. Try again shortly." };
  return { code: c, kind: "OTHER", retryable: false, message: (error?.message ?? `WhatsApp refused the request (${httpStatus}).`).slice(0, 300) };
}
