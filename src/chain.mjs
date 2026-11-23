import { LABEL, RETRYABLE } from "./classify.mjs";

// Walks a list of { provider, model } steps until one answers.
// - A retryable failure (overloaded, quota, missing model, network, per-step timeout) moves to the next step.
// - A dropped connection gets one retry on the same step first.
// - Anything else (auth, tool policy, a bad prompt) stops: another model would fail the same way.
// - `hardMs` bounds the whole chain, so a caller with its own timeout still gets an answer or a clear failure.
export async function runChain(steps, prompt, { hardMs = 9 * 60_000, stepMs, cwd, env, onStep, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), netRetryMs = 10_000 } = {}) {
  const started = now();
  const left = () => hardMs - (now() - started);
  const attempts = [];
  for (const step of steps) {
    if (left() < 5_000) break;
    onStep?.(step, attempts);
    const timeoutMs = Math.max(1_000, Math.min(stepMs ?? Infinity, left()));
    const t0 = now();
    let r = await step.provider.run(step.model, prompt, { timeoutMs, cwd, env });
    if (!r.ok && r.kind === "net" && left() > netRetryMs + 30_000) {
      await sleep(netRetryMs);
      r = await step.provider.run(step.model, prompt, { timeoutMs: Math.min(timeoutMs, left()), cwd, env });
    }
    const attempt = { provider: step.provider.name, model: step.model, ok: r.ok, kind: r.ok ? null : r.kind ?? "other", reason: r.ok ? null : LABEL[r.kind] ?? r.error, ms: now() - t0 };
    attempts.push(attempt);
    if (r.ok) return { ok: true, text: r.text, provider: attempt.provider, model: attempt.model, attempts, ms: now() - started };
    if (!RETRYABLE.has(r.kind)) break;
  }
  return { ok: false, text: null, attempts, ms: now() - started };
}
