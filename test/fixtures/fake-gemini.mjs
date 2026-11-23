#!/usr/bin/env node
// Stand-in for Gemini CLI. Behaviour is picked by the model name:
//   busy-*   logs "Attempt N failed with status 503" every 50 ms forever (like the real CLI's backoff)
//   quota-*  fails with a 429 error JSON
//   ok-*     answers after 50 ms
const m = process.argv[process.argv.indexOf("-m") + 1];
if (m.startsWith("busy")) {
  let n = 1;
  setInterval(() => process.stderr.write(`Attempt ${n++} failed with status 503. Retrying with backoff...\n`), 50);
} else if (m.startsWith("quota")) {
  process.stdout.write(JSON.stringify({ error: { message: "RESOURCE_EXHAUSTED: quota exceeded (429)" } }));
  process.exit(1);
} else {
  setTimeout(() => { process.stdout.write(JSON.stringify({ response: `answer from ${m}` })); process.exit(0); }, 50);
}
