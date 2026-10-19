// Stand-ins for Cloudinary and Firebase Cloud Messaging so the test suites can exercise the REAL server
// code (the real Cloudinary SDK, the real FCM client) without the internet or any account.
//
//   node scripts/fake-providers.mjs            (port 3998)
//   server env: CLOUDINARY_CLOUD_NAME=test CLOUDINARY_API_KEY=k CLOUDINARY_API_SECRET=s
//               CLOUDINARY_UPLOAD_PREFIX=https://localhost:3997/cloud + NODE_TLS_REJECT_UNAUTHORIZED=0
//               FCM_API_BASE=http://localhost:3998/fcm FCM_TOKEN_URL=http://localhost:3998/fcm/token
//               FCM_SERVICE_ACCOUNT_JSON='{"project_id":"test-proj","client_email":"t@test-proj.iam","private_key":"<any RSA key>"}'
//
// Control (used by the tests):  POST /__control {…}   GET /__state   POST /__reset   GET /fcm/__sent
import http from "node:http";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const PORT = Number(process.env.FAKE_PORT || 3998);
const state = { assets: new Map(), control: {}, fcm: [], fcmCalls: new Map() };
const resetState = () => { state.hits = []; state.assets.clear(); state.control = {}; state.fcm = []; state.fcmCalls.clear(); };

function json(res, code, body) { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); }
async function body(req) { const c = []; for await (const x of req) c.push(x); return Buffer.concat(c); }
function fields(buf, type) {
  const out = {};
  const text = buf.toString("latin1");
  const m = /boundary=(.+)$/.exec(type || "");
  if (m) {
    for (const part of text.split("--" + m[1])) {
      const h = /name="([^"]+)"/.exec(part);
      if (!h) continue;
      const i = part.indexOf("\r\n\r\n");
      out[h[1]] = part.slice(i + 4).replace(/\r\n$/, "");
    }
  } else for (const [k, v] of new URLSearchParams(text)) out[k] = v;
  return out;
}
const total = () => Array.from(state.assets.values()).reduce((a, x) => a + x.bytes, 0);

const handler = async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  try {
    if (p === "/__reset") { resetState(); return json(res, 200, { ok: true }); }
    if (p === "/__control") { Object.assign(state.control, JSON.parse((await body(req)).toString() || "{}")); return json(res, 200, state.control); }
    if (p === "/__seed") { const b = JSON.parse((await body(req)).toString()); state.assets.set(b.publicId, { public_id: b.publicId, bytes: b.bytes ?? 1000, format: "jpg", created_at: b.createdAt ?? new Date().toISOString(), secure_url: `http://localhost:${PORT}/img/${b.publicId}` }); return json(res, 200, { ok: true }); }
    if (p === "/__state") return json(res, 200, { assets: Array.from(state.assets.values()), control: state.control, hits: state.hits || [] });

    // Google short links + address search, for the property map-link tests.
    if (p.startsWith("/short/")) {
      const name = p.slice(7);
      const to = state.control.short?.[name];
      if (to === undefined) { res.writeHead(404); return res.end("dead"); }
      res.writeHead(302, { Location: to }); return res.end();
    }
    if (p === "/nominatim/search") {
      const q = (url.searchParams.get("q") || "").toLowerCase();
      const hit = (state.control.places || []).filter((x) => q.includes(x.match));
      return json(res, 200, hit.map((x) => ({ lat: String(x.lat), lon: String(x.lon), display_name: x.name, address: x.address || {} })));
    }
    // Private delivery domain (CLOUDINARY_DELIVERY_HOST): only SIGNED urls (…/s--sig--/…) are served.
    if (p.startsWith("/image/upload/")) {
      state.hits = state.hits || []; state.hits.push(p);
      if (state.control.imgStatus) { res.writeHead(state.control.imgStatus); return res.end("denied"); }
      if (!/\/s--[^/]+--\//.test(p)) { res.writeHead(401); return res.end("unsigned"); }
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": png.length }); return res.end(png);
    }
    // Delivery URLs (secure_url): a tiny valid PNG, so the ERP's photo proxy has something real to stream.
    if (p.startsWith("/img/")) {
      state.hits = state.hits || []; state.hits.push(p);
      if (state.control.requireSig) { res.writeHead(401); return res.end("private"); }
      if (state.control.imgStatus) { res.writeHead(state.control.imgStatus); return res.end("denied"); }
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": png.length });
      return res.end(png);
    }

    // ---------------------------------------------------------------- Cloudinary: /cloud/v1_1/<cloud>/…
    const c = /^\/cloud\/v1_1\/[^/]+\/(.+)$/.exec(p);
    if (c) {
      const route = c[1];
      if (state.control.rejectAll) return json(res, 401, { error: { message: "Invalid credentials" } });
      if (route === "image/upload" && req.method === "POST") {
        const f = fields(await body(req), req.headers["content-type"]);
        const data = (f.file || "").replace(/^data:[^,]*,/, "");
        const bytes = Buffer.from(data, "base64").length;
        if (state.control.failUpload) return json(res, 500, { error: { message: "upload failed" } });
        const id = `${f.folder || "root"}/${randomBytes(6).toString("hex")}`;
        const a = { public_id: id, bytes, width: 640, height: 480, format: "jpg", created_at: new Date().toISOString(), secure_url: `http://localhost:${PORT}/img/${id}.jpg` };
        state.assets.set(id, a);
        return json(res, 200, a);
      }
      if (route === "usage" && req.method === "GET") {
        if (state.control.failUsage) return json(res, 500, { error: { message: "usage unavailable" } });
        const storage = { usage: state.control.usageBytes ?? total() };
        if (state.control.limitBytes) storage.limit = state.control.limitBytes;
        return json(res, 200, { plan: "Test plan", storage });
      }
      if (route === "resources/image/upload" && req.method === "GET") {
        if (state.control.failList) return json(res, 500, { error: { message: "list failed" } });
        const prefix = url.searchParams.get("prefix") || "";
        const max = Number(url.searchParams.get("max_results") || 100);
        const start = Number(url.searchParams.get("next_cursor") || 0);
        const all = Array.from(state.assets.values()).filter((a) => a.public_id.startsWith(prefix)).sort((a, b) => a.public_id.localeCompare(b.public_id));
        const page = all.slice(start, start + max);
        return json(res, 200, { resources: page, ...(start + max < all.length ? { next_cursor: String(start + max) } : {}) });
      }
      if (route === "image/destroy" && req.method === "POST") {
        const f = fields(await body(req), req.headers["content-type"]);
        if ((state.control.failDestroy || []).includes(f.public_id) || state.control.failDestroyAll) return json(res, 500, { error: { message: "destroy failed" } });
        const had = state.assets.delete(f.public_id);
        return json(res, 200, { result: had ? "ok" : "not found" });
      }
      return json(res, 404, { error: { message: "unknown route " + route } });
    }

    // ---------------------------------------------------------------- FCM
    if (p === "/fcm/token" && req.method === "POST") return json(res, 200, { access_token: "fake-access-token", expires_in: 3600 });
    const m = /^\/fcm\/v1\/projects\/([^/]+)\/messages:send$/.exec(p);
    if (m && req.method === "POST") {
      if (req.headers.authorization !== "Bearer fake-access-token") return json(res, 401, { error: { status: "UNAUTHENTICATED" } });
      const msg = JSON.parse((await body(req)).toString()).message;
      const n = (state.fcmCalls.get(msg.token) ?? 0) + 1;
      state.fcmCalls.set(msg.token, n);
      if (msg.token.startsWith("dead-")) return json(res, 404, { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } });
      if (msg.token.startsWith("flaky-") && n === 1) return json(res, 503, { error: { status: "UNAVAILABLE" } });
      state.fcm.push(msg);
      return json(res, 200, { name: "projects/test/messages/" + state.fcm.length });
    }
    if (p === "/fcm/__sent") return json(res, 200, state.fcm);
    json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, 500, { error: String(e) });
  }
};
const server = http.createServer(handler);
server.listen(PORT, () => console.log(`fake providers on :${PORT} (http)`));

// The Cloudinary SDK always speaks HTTPS, so the same fake is served over TLS with a throw-away
// self-signed certificate on PORT-1 (start the ERP server with NODE_TLS_REJECT_UNAUTHORIZED=0 for tests only).
try {
  const dir = mkdtempSync(join(tmpdir(), "fake-tls-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "2", "-subj", "/CN=localhost"], { stdio: "ignore" });
  https.createServer({ key: readFileSync(join(dir, "k.pem")), cert: readFileSync(join(dir, "c.pem")) }, handler).listen(PORT - 1, () => console.log(`fake providers on :${PORT - 1} (https)`));
} catch (e) {
  console.log("TLS fake not started:", String(e));
}
