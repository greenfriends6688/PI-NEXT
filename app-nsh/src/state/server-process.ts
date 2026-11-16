// The app's agent lifecycle, as the shell and the connection card see it.
//
// The work happens in `api/link.ts`: one process, one pipe, no address. Nothing
// listens on a port, and the window never connects to a URL — the agent is the
// app's own process, started from the Node runtime the bundle carries, and this
// module is just the name the shell imports, so `App.tsx` and
// `screens/Connection.tsx` keep their shape:
//
//   ensureServer() at launch, ownsServer()/stopServer() on quit, and the three
//   signals the connection card reads while a start is in flight.
import {
  agentFailure,
  agentLog,
  agentPhase,
  agentRunning,
  serverState,
  startAgent,
  stopAgent,
} from "../api/link";

/** Starts the agent if it is not up. Resolves whether the shell can be drawn. */
export const ensureServer = startAgent;

/** Stops the agent this app started (nothing when it was never started). */
export const stopServer = stopAgent;

/** Whether this app started the agent, so quitting should stop it. */
export function ownsServer(): boolean {
  return agentRunning();
}

export const serverPhase = agentPhase;
export const serverLog = agentLog;
export const serverFailure = agentFailure;
export { serverState };
