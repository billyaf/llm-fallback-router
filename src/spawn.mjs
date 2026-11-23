import { spawn } from "node:child_process";

// Runs one CLI call. `watch` sees stderr as it streams and may return a reason to stop early
// (e.g. the CLI's own retry log says the model is overloaded). `timeoutMs` is a hard stop.
export function runProcess(cmd, args, { cwd, env, timeoutMs, watch, input } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env, stdio: [input == null ? "ignore" : "pipe", "pipe", "pipe"] });
    let out = "", err = "", cut = null;
    const stop = (why) => {
      if (cut) return;
      cut = why;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000).unref();
    };
    const timer = timeoutMs ? setTimeout(() => stop("time"), timeoutMs) : null;
    if (input != null) child.stdin.end(input);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => {
      err += d;
      const why = watch?.(err);
      if (why) stop(why);
    });
    child.on("error", (e) => { if (timer) clearTimeout(timer); resolve({ code: -1, out, err: `cannot run ${cmd}: ${e.message}`, cut }); });
    child.on("close", (code) => { if (timer) clearTimeout(timer); resolve({ code, out, err, cut }); });
  });
}
