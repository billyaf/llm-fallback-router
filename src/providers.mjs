import { runProcess } from "./spawn.mjs";
import { classify } from "./classify.mjs";

// Gemini CLI retries a 503 about ten times with backoff (~6 minutes) before it gives up. We read its
// retry log and stop at the Nth retry so the chain can move on while there is still time left.
export function geminiWatch(maxRetries = 2) {
  return (stderr) => {
    const last = [...stderr.matchAll(/Attempt (\d+) failed with status (503|429)/g)].pop();
    if (last && Number(last[1]) >= maxRetries) return last[2] === "429" ? "quota" : "busy";
    return null;
  };
}

export function gemini({ bin = "gemini", extraArgs = [], maxRetries = 2 } = {}) {
  return {
    name: "gemini",
    async run(model, prompt, { timeoutMs, cwd, env }) {
      const r = await runProcess(bin, ["-p", prompt, "-m", model, "--output-format", "json", ...extraArgs], { cwd, env, timeoutMs, watch: geminiWatch(maxRetries) });
      let json = null;
      try { json = JSON.parse(r.out); } catch {}
      const text = json?.response ?? r.out.trim();
      const error = r.cut ? null : json?.error?.message ?? (r.code === 0 ? null : r.err.trim().split("\n").slice(-3).join(" "));
      return { ok: r.code === 0 && !r.cut && !error && !!text, text, kind: r.cut ?? (error ? classify(error) : null), error, raw: r };
    },
  };
}

export function claude({ bin = "claude", extraArgs = [] } = {}) {
  return {
    name: "claude",
    async run(model, prompt, { timeoutMs, cwd, env }) {
      const args = ["-p", "--output-format", "json", ...(model ? ["--model", model] : []), ...extraArgs];
      const r = await runProcess(bin, args, { cwd, env, timeoutMs, input: prompt });
      let json = null;
      try { json = JSON.parse(r.out); } catch {}
      const text = json?.result ?? r.out.trim();
      const error = r.cut ? null : json?.is_error ? text : r.code === 0 ? null : r.err.trim().split("\n").slice(-3).join(" ");
      return { ok: r.code === 0 && !r.cut && !error && !!text, text, kind: r.cut ?? (error ? classify(error) : null), error, raw: r };
    },
  };
}
