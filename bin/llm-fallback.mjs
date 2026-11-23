#!/usr/bin/env node
// llm-fallback: answer a prompt with the first model in the chain that is available.
//
//   llm-fallback "prompt"                       uses ./fallback.config.json if present
//   llm-fallback --prompt-file task.md --chain gemini:gemini-flash-latest,gemini:gemini-flash-lite-latest,claude:sonnet
//   llm-fallback ... --json                     print the full result (attempts, timings) as JSON
//
// Exit code 0 = answered, 1 = every step failed (stderr says why, so a caller can fall back itself).
import { readFileSync, existsSync } from "node:fs";
import { runChain } from "../src/chain.mjs";
import { gemini, claude } from "../src/providers.mjs";

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv.splice(i, 2)[1] : undefined; };
const bool = (name) => { const i = argv.indexOf(name); if (i >= 0) argv.splice(i, 1); return i >= 0; };

const cfg = existsSync("fallback.config.json") ? JSON.parse(readFileSync("fallback.config.json", "utf8")) : {};
const promptFile = flag("--prompt-file");
const chainArg = flag("--chain");
const hardSec = Number(flag("--timeout") ?? cfg.timeoutSeconds ?? 540);
const asJson = bool("--json");
const prompt = promptFile ? readFileSync(promptFile, "utf8") : argv.join(" ").trim();
if (!prompt) { console.error('usage: llm-fallback "prompt" | --prompt-file f [--chain provider:model,...] [--timeout s] [--json]'); process.exit(2); }

const PROVIDERS = { gemini: gemini(cfg.gemini), claude: claude(cfg.claude) };
const chain = (chainArg ? chainArg.split(",") : cfg.chain ?? ["gemini:gemini-flash-latest", "gemini:gemini-flash-lite-latest", "claude:sonnet"]).map((s) => {
  const [p, ...m] = s.split(":");
  if (!PROVIDERS[p]) { console.error(`unknown provider: ${p}`); process.exit(2); }
  return { provider: PROVIDERS[p], model: m.join(":") };
});

const res = await runChain(chain, prompt, {
  hardMs: hardSec * 1000,
  onStep: (s, done) => done.length && console.error(`llm-fallback: ${done.at(-1).model} failed (${done.at(-1).reason}), trying ${s.provider.name}:${s.model}`),
});
if (asJson) console.log(JSON.stringify(res, null, 2));
else if (res.ok) console.log(res.text);
if (!res.ok) {
  console.error(`llm-fallback: every model failed: ${res.attempts.map((a) => `${a.model} (${a.reason})`).join("; ") || "time limit reached"}`);
  process.exit(1);
}
