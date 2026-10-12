import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  SubmitDedup,
  createSubmitRequestId,
  reuseRequestIdAfterAmbiguousFailure,
  submissionFingerprint,
} = await jiti.import("./submit-idempotency.ts");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("fingerprint is stable and content sensitive", () => {
  const a = submissionFingerprint({ message: "hello" });
  assert.equal(a, submissionFingerprint({ message: "hello" }));
  assert.notEqual(a, submissionFingerprint({ message: "hello " }));
  assert.notEqual(a, submissionFingerprint({ message: "hello", streamingBehavior: "steer" }));
});

test("fingerprint separates images by content, not just presence", () => {
  const one = submissionFingerprint({ message: "x", images: [{ data: "AAAA", mimeType: "image/png" }] });
  const two = submissionFingerprint({ message: "x", images: [{ data: "BBBB", mimeType: "image/png" }] });
  const three = submissionFingerprint({ message: "x", images: [{ data: "AAAA", mimeType: "image/jpeg" }] });
  assert.notEqual(one, two);
  assert.notEqual(one, three);
});

test("request ids are unique and non-empty", () => {
  const a = createSubmitRequestId();
  const b = createSubmitRequestId();
  assert.ok(a.length > 0);
  assert.notEqual(a, b);
});

test("reuses the request id only when the content matches", () => {
  const previous = { requestId: "req-1", fingerprint: submissionFingerprint({ message: "same" }) };
  assert.equal(
    reuseRequestIdAfterAmbiguousFailure(previous, submissionFingerprint({ message: "same" })),
    "req-1",
  );
  assert.equal(
    reuseRequestIdAfterAmbiguousFailure(previous, submissionFingerprint({ message: "edited" })),
    null,
  );
  assert.equal(reuseRequestIdAfterAmbiguousFailure(null, "anything"), null);
});

test("duplicate submission joins the in-flight one instead of starting a second run", async () => {
  const dedup = new SubmitDedup({ ttlMs: 0 });
  const fingerprint = submissionFingerprint({ message: "run once" });

  const first = dedup.begin("req-1", fingerprint);
  assert.equal(first.kind, "new");

  const second = dedup.begin("req-1", fingerprint);
  assert.equal(second.kind, "join");

  let settled = false;
  second.promise.then(() => { settled = true; });
  assert.equal(settled, false);

  first.resolve();
  await second.promise;
  assert.equal(settled, true);
});

test("same request id with different content is a conflict", () => {
  const dedup = new SubmitDedup({ ttlMs: 0 });
  dedup.begin("req-1", submissionFingerprint({ message: "a" }));
  assert.equal(dedup.begin("req-1", submissionFingerprint({ message: "b" })).kind, "conflict");
});

test("a rejected submission is forgotten so the retry can proceed", async () => {
  const dedup = new SubmitDedup({ ttlMs: 0 });
  const fingerprint = submissionFingerprint({ message: "retry me" });

  const first = dedup.begin("req-1", fingerprint);
  const joined = dedup.begin("req-1", fingerprint);
  assert.equal(joined.kind, "join");

  first.reject(new Error("preflight rejected"));
  await assert.rejects(joined.promise, /preflight rejected/);

  // The rejected entry must be gone: a retry with the same id starts fresh.
  assert.equal(dedup.begin("req-1", fingerprint).kind, "new");
});

test("an accepted submission is remembered until the ttl expires", async () => {
  const dedup = new SubmitDedup({ ttlMs: 20 });
  const fingerprint = submissionFingerprint({ message: "done" });
  const first = dedup.begin("req-1", fingerprint);
  first.resolve();
  assert.equal(dedup.begin("req-1", fingerprint).kind, "join");
  await sleep(40);
  assert.equal(dedup.begin("req-1", fingerprint).kind, "new");
});

test("the table stays bounded", () => {
  const dedup = new SubmitDedup({ ttlMs: 0, maxEntries: 4 });
  for (let index = 0; index < 10; index += 1) {
    dedup.begin(`req-${index}`, submissionFingerprint({ message: `m${index}` }));
  }
  assert.ok(dedup.size <= 4, `expected <= 4 entries, got ${dedup.size}`);
});
