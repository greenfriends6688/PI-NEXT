// How this window reaches the agent, as plain signals.
//
// A module of its own (importing nothing but `nsh`) so the API clients can read
// it without pulling in the transport: `link.ts` is imported by `client.ts`,
// and `files.ts` asking `link.ts` would close a loop the bundler has to untangle.
import { signal } from "nsh";

/**
 * True once the window has decided it is attached: it answers its own `/api/*`
 * (`src/local`) and drives the `pi` on this machine.
 */
export const attachedMode = signal(false);

/**
 * Whether anything still answers the routes the window does not: the bundled
 * server or a development one. With neither there is no URL to ask, so media
 * (`Image`, `Video`, `AudioPlayer`) reads the file itself.
 */
export const serverBacked = signal(false);
