# llm-fallback-router

Run a prompt through a chain of LLM CLIs, for example **Gemini Flash → Gemini Flash-Lite → Claude Sonnet**, and get an answer from the first model that is available. An overloaded model is **cut off early**, so its retries don't burn your time budget.

Built for an agent orchestrator. Cheap research agents run on a free-tier Gemini key, and the orchestrator itself has a hard 10-minute timeout per tool call.

## Why this exists

The first version of the agent runner just called `gemini -p …`. On a free-tier key that failed in three ways:

| Failure | What Gemini CLI does | Cost |
|---|---|---|
| Model overloaded (503) | Retries ~10 times with backoff, then fails | **~6 minutes** lost before you learn anything |
| Quota (429) / model retired (404) | Fails | the run fails |
| Dropped connection | Fails | the run fails |

Retrying the same model on top of that made it worse: one run took more than 10 minutes and hit the orchestrator's timeout, so even the Claude fallback never ran.

## How it works

```
prompt ─► step 1: gemini-flash-latest ──503 retry #2──► cut (≈seconds, not 6 min)
          step 2: gemini-flash-lite    ──ok──────────► answer
          step 3: claude sonnet        (only if every Gemini step failed)
          └── whole chain bounded by --timeout (default 9 min)
```

- **Early cut.** The CLI's stderr is watched while it streams. At the 2nd `Attempt N failed with status 503|429` line the process is killed and the chain moves on.
- **Failure classes** (`src/classify.mjs`):
  - Overloaded, quota, missing model and network errors are worth another model.
  - Auth, tool-policy or prompt errors stop the chain, because the next model would fail the same way.
- **One retry for a dropped connection** on the same model, before moving on.
- **Hard budget** for the whole chain, so the caller always gets an answer or a clear failure before its own timeout.
- **Exit code 1 plus a reason on stderr** when everything fails, so a parent process can fall back on its own.

Real run from the orchestrator: `gemini-flash-latest` returned 503 and was cut, `gemini-flash-lite-latest` answered, **38 s total**. Before this change the same run timed out after more than 10 minutes.

## Usage

Requires Node 20+ and the CLIs you put in the chain ([Gemini CLI](https://github.com/google-gemini/gemini-cli), [Claude Code](https://claude.com/claude-code)).

```bash
node bin/llm-fallback.mjs "Summarise the trade-offs of SQLite vs Postgres in 5 bullets"
node bin/llm-fallback.mjs --prompt-file task.md --chain gemini:gemini-flash-latest,claude:haiku --timeout 300
node bin/llm-fallback.mjs --prompt-file task.md --json     # attempts, kinds, timings
```

Copy `fallback.config.example.json` to `fallback.config.json` to set a default chain.

As a library:

```js
import { runChain } from "./src/chain.mjs";
import { gemini, claude } from "./src/providers.mjs";

const g = gemini(), c = claude();
const res = await runChain(
  [{ provider: g, model: "gemini-flash-latest" }, { provider: g, model: "gemini-flash-lite-latest" }, { provider: c, model: "sonnet" }],
  "Your prompt",
  { hardMs: 9 * 60_000 },
);
// res = { ok, text, provider, model, attempts: [{ model, kind, reason, ms }], ms }
```

Adding a provider means writing an object with `name` and `run(model, prompt, { timeoutMs })` that returns `{ ok, text, kind, error }`.

## Tests

```bash
npm test
```

The end-to-end test uses `test/fixtures/fake-gemini.mjs`, which imitates the CLI's 503 backoff log, a 429, and a success. It checks that the overloaded model is cut in well under a second instead of being waited out.

## License

MIT
