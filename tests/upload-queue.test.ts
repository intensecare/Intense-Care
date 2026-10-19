import "fake-indexeddb/auto";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { drainQueue, enqueuePhoto, listQueue, queueCounts, removeQueued, retryFailedUploads, sendPhoto } from "../src/lib/mobile/upload-queue";

/** Scripted XMLHttpRequest: each send() consumes the next planned outcome. */
type Plan = { status: number; body?: unknown } | "network" | "timeout";
let plan: Plan[] = [];
const sent: { body: string }[] = [];
class FakeXHR {
  upload: { onprogress: null | ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) } = { onprogress: null };
  status = 0;
  responseText = "";
  timeout = 0;
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  ontimeout: null | (() => void) = null;
  onabort: null | (() => void) = null;
  open() {}
  setRequestHeader() {}
  abort() { this.onabort?.(); }
  send(body: string) {
    sent.push({ body });
    const p = plan.shift() ?? { status: 200, body: { success: true, data: { id: "photo-" + sent.length } } };
    setTimeout(() => {
      if (p === "network") return this.onerror?.();
      if (p === "timeout") return this.ontimeout?.();
      this.status = p.status;
      this.responseText = JSON.stringify(p.body ?? {});
      this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
      this.onload?.();
    }, 0);
  }
}
(globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXHR;
(globalThis as unknown as { FileReader: unknown }).FileReader = class {
  result: string | null = null;
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  readAsDataURL(b: Blob) {
    b.arrayBuffer().then((ab) => {
      this.result = "data:" + (b.type || "image/png") + ";base64," + Buffer.from(ab).toString("base64");
      this.onload?.();
    });
  }
};

const blob = () => new Blob([new Uint8Array(100).fill(7)], { type: "image/png" });
const meta = { jobId: "job1", area: "Hall", photoType: "before" as const };

beforeEach(async () => {
  plan = [];
  sent.length = 0;
  for (const q of await listQueue()) await removeQueued(q.id);
});

test("a photo is only 'sent' when the server answers with a saved photo", async () => {
  plan = [{ status: 200, body: { success: true, data: { id: "p1" } } }];
  const r = await sendPhoto({ ...meta, id: "up1" }, "data:image/png;base64,AAAA");
  assert.equal(r.ok, true);
  plan = [{ status: 200, body: { success: true } }]; // 200 without a photo is NOT a confirmation
  const r2 = await sendPhoto({ ...meta, id: "up2" }, "data:image/png;base64,AAAA");
  assert.equal(r2.ok, false);
});

test("the upload id travels with the photo so a retry can't create a second copy", async () => {
  await sendPhoto({ ...meta, id: "up-stable" }, "data:image/png;base64,AAAA");
  assert.equal(JSON.parse(sent[0].body).clientUploadId, "up-stable");
});

test("network down → kept at full size, not uploaded; later drained exactly once", async () => {
  const e = await enqueuePhoto({ ...meta, image: blob(), id: "q1" });
  assert.equal(e.status, "PENDING");
  plan = ["network"];
  let d = await drainQueue();
  assert.equal(d.sent, 0);
  assert.equal(d.left, 1);
  assert.equal((await listQueue())[0].status, "PENDING");
  assert.equal((await listQueue())[0].attempts, 1);
  const uploaded: unknown[] = [];
  d = await drainQueue((p) => uploaded.push(p));
  assert.equal(d.sent, 1);
  assert.equal(uploaded.length, 1);
  assert.equal((await listQueue()).length, 0);
  assert.equal(sent.length, 2);
});

test("a photo the server refuses is marked FAILED with the reason — not retried forever, not deleted", async () => {
  await enqueuePhoto({ ...meta, image: blob(), id: "q2" });
  plan = [{ status: 403, body: { success: false, error: "You can't add photos to this job." } }];
  const d = await drainQueue();
  assert.equal(d.failed, 1);
  const q = (await listQueue())[0];
  assert.equal(q.status, "FAILED");
  assert.match(q.lastError ?? "", /can't add photos/);
  const again = await drainQueue();
  assert.equal(again.sent + again.failed, 0, "failed photos are not retried automatically");
  assert.equal(sent.length, 1);
  assert.deepEqual(await queueCounts(), { pending: 0, failed: 1, bytes: 100 });
});

test("retry failed puts them back in line", async () => {
  await enqueuePhoto({ ...meta, image: blob(), id: "q3" });
  plan = [{ status: 400, body: { success: false, error: "bad" } }];
  await drainQueue();
  const r = await retryFailedUploads();
  assert.equal(r.sent, 1);
  assert.equal((await listQueue()).length, 0);
});

test("server errors and timeouts are retried later; progress is kept in order", async () => {
  await enqueuePhoto({ ...meta, image: blob(), id: "a" });
  await enqueuePhoto({ ...meta, image: blob(), id: "b" });
  plan = [{ status: 503, body: {} }, { status: 503, body: {} }];
  let d = await drainQueue();
  assert.equal(d.sent, 0);
  assert.equal(d.left, 2);
  plan = [{ status: 200, body: { success: true, data: { id: "pa" } } }, "timeout"];
  d = await drainQueue();
  assert.equal(d.sent, 1);
  assert.equal(d.left, 1);
  assert.deepEqual((await listQueue()).map((q) => q.id), ["b"]);
});

test("two drains at once do not send a photo twice", async () => {
  await enqueuePhoto({ ...meta, image: blob(), id: "c" });
  const [x, y] = await Promise.all([drainQueue(), drainQueue()]);
  assert.equal(x.sent, 1);
  assert.equal(y.sent, 1, "the second caller shares the first run instead of starting another");
  assert.equal(sent.length, 1);
});

test("the queue keeps the original bytes", async () => {
  await enqueuePhoto({ ...meta, image: blob(), id: "d" });
  const q = (await listQueue())[0];
  assert.equal(q.bytes, 100);
  assert.equal((await q.image.arrayBuffer()).byteLength, 100);
});
