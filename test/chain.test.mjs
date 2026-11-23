import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { runChain } from "../src/chain.mjs";
import { classify } from "../src/classify.mjs";
import { gemini, geminiWatch } from "../src/providers.mjs";

const fake = (script) => ({ name: "fake", run: async (model) => script[model] ?? { ok: false, kind: "other", error: "?" } });

test("classify maps CLI errors to kinds", () => {
  assert.equal(classify("The model is overloaded. Please try again later. (503)"), "busy");
  assert.equal(classify("RESOURCE_EXHAUSTED"), "quota");
  assert.equal(classify("models/gemini-2.5-pro is no longer available"), "model");
  assert.equal(classify("TypeError: fetch failed"), "net");
  assert.equal(classify("API key not valid"), "other");
});

test("moves to the next model on a retryable failure", async () => {
  const p = fake({ a: { ok: false, kind: "busy" }, b: { ok: true, text: "hi" } });
  const r = await runChain([{ provider: p, model: "a" }, { provider: p, model: "b" }], "x");
  assert.equal(r.ok, true);
  assert.equal(r.model, "b");
  assert.deepEqual(r.attempts.map((a) => a.kind), ["busy", null]);
});

test("stops on a non-retryable failure (another model would fail the same way)", async () => {
  const p = fake({ a: { ok: false, kind: "other", error: "API key not valid" }, b: { ok: true, text: "hi" } });
  const r = await runChain([{ provider: p, model: "a" }, { provider: p, model: "b" }], "x");
  assert.equal(r.ok, false);
  assert.equal(r.attempts.length, 1);
});

test("retries a dropped connection once on the same model", async () => {
  let calls = 0;
  const p = { name: "fake", run: async () => (++calls === 1 ? { ok: false, kind: "net" } : { ok: true, text: "ok" }) };
  const r = await runChain([{ provider: p, model: "a" }], "x", { sleep: async () => {} });
  assert.equal(r.ok, true);
  assert.equal(calls, 2);
});

test("respects the overall time budget", async () => {
  let t = 0;
  const p = { name: "fake", run: async () => { t += 60_000; return { ok: false, kind: "busy" }; } };
  const steps = Array.from({ length: 20 }, (_, i) => ({ provider: p, model: `m${i}` }));
  const r = await runChain(steps, "x", { hardMs: 3 * 60_000, now: () => t });
  assert.equal(r.ok, false);
  assert.ok(r.attempts.length <= 3);
});

test("geminiWatch cuts at the Nth 503 retry", () => {
  const w = geminiWatch(2);
  assert.equal(w("Attempt 1 failed with status 503"), null);
  assert.equal(w("Attempt 1 failed with status 503\nAttempt 2 failed with status 503"), "busy");
  assert.equal(w("Attempt 2 failed with status 429"), "quota");
});

test("end to end with a fake Gemini CLI: busy → quota → ok", async () => {
  const bin = fileURLToPath(new URL("./fixtures/fake-gemini.mjs", import.meta.url));
  const g = gemini({ bin });
  const t0 = Date.now();
  const r = await runChain([{ provider: g, model: "busy-flash" }, { provider: g, model: "quota-pro" }, { provider: g, model: "ok-lite" }], "hello", { hardMs: 30_000 });
  assert.equal(r.ok, true);
  assert.equal(r.text, "answer from ok-lite");
  assert.deepEqual(r.attempts.map((a) => a.kind), ["busy", "quota", null]);
  assert.ok(Date.now() - t0 < 5_000, "the overloaded model was cut early, not waited out");
});
