// Turns an error message from an LLM CLI into a failure kind. Only some kinds are worth trying another
// model for: an overloaded model (busy), quota, a missing model, or a dropped connection. Auth, tool and
// policy errors will fail the same way on the next model, so the chain stops there.
export const LABEL = {
  busy: "model overloaded (503)",
  net: "network error",
  quota: "quota exhausted (429)",
  model: "model not available",
  time: "time limit reached",
  other: "other error",
};

export function classify(message = "") {
  const m = String(message);
  if (/high demand|overloaded|\b503\b|UNAVAILABLE/i.test(m)) return "busy";
  if (/fetch failed|ENOTFOUND|ECONN|ETIMEDOUT|socket hang up/i.test(m)) return "net";
  if (/quota|\b429\b|RESOURCE_EXHAUSTED|rate limit/i.test(m)) return "quota";
  if (/no longer available|not found|\b404\b|not supported for|is not available/i.test(m)) return "model";
  return "other";
}

export const RETRYABLE = new Set(["busy", "net", "quota", "model", "time"]);
