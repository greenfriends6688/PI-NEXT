// Is the app's agent up, and what is it doing.
//
// The pi coding agent (the SDK) is a Node package; the window runs in QuickJS, so
// the agent is the app's own process (`api/link.ts`), talking to the window over
// a pipe — not over a URL. One switch, `serverState`, says whether it answers;
// `agentPhase`/`agentLog`/`agentFailure` in `api/link.ts` say what the start is
// doing, and the connection card reads those directly.
import { api, req } from "../api/client";
import { serverState } from "../api/link";

// The shell reads `serverState` from here (it is the app's connection switch);
// the value itself lives with the process that owns it.
export { serverState };

/** How long a probe waits for an answer (a stopped agent rejects at once). */
const PROBE_TIMEOUT_MS = 2500;

let probing = false;

/** One probe: any API answer means the agent is there. */
export async function probeServer(): Promise<boolean> {
  if (probing) return serverState() === "up";
  probing = true;
  try {
    await req("/api/sessions", {}, { timeoutMs: PROBE_TIMEOUT_MS });
    serverState.set("up");
    return true;
  } catch (error) {
    // A refusal the agent itself wrote (an error body with a status) still means
    // it answered.
    const status = (error as { status?: number }).status;
    if (typeof status === "number" && status > 0) {
      serverState.set("up");
      return true;
    }
    serverState.set("down");
    return false;
  } finally {
    probing = false;
  }
}

/** Probes now; used by the Retry button. */
export function checkServer(): Promise<boolean> {
  return probeServer();
}

/**
 * What the connection card names as the place the app talks to. There is no
 * address in a packaged app — the agent is inside it — and the browser build
 * talks to its own origin, which `api.base()` holds.
 */
export function serverAddress(): string {
  return api.base() || "the agent inside this app";
}
