/**
 * The account this desktop is signed in to.
 *
 * The origin is **your own** account service, never somebody else's. The contract it has to
 * satisfy is written down in `docs/pinext-cloud-contract-2026-10-13.md`: sign-in, device
 * registry, ICE handout and the WebRTC signaling relay. Until that service exists, account
 * sign-in and the official remote path simply do not work — the LAN listener, mDNS and the
 * tunnel are the paths that still do.
 *
 * Shared by Main, which owns the sign-in and the credential, and the renderer, which only
 * ever sees this: who is signed in, never the token that proves it.
 */
export type AccountUser = {
  id: string;
  /** The GitHub username the account was created from. */
  login: string;
  avatarUrl: string | null;
  email: string | null;
  role: "user" | "admin";
};

export type AccountStatus = "signed-out" | "signing-in" | "signed-in";

export type AccountState = {
  status: AccountStatus;
  /** Present while `signed-in`; kept when a refresh could not reach the server. */
  user?: AccountUser;
  /** Why the last sign-in did not complete, for a person to read. Cleared by the next attempt. */
  error?: string;
  /** The site the account lives on, for the 控制台 link. */
  origin: string;
};

/**
 * Where the desktop signs in.
 *
 * `PINEXT_CLOUD_URL` overrides it (development against a local server). The default names
 * the host this project's own service is meant to live on; change it to wherever you
 * actually deploy `docs/pinext-cloud-contract-2026-10-13.md`. A build whose origin points
 * at a service that does not exist yet fails sign-in with a network error and nothing else
 * breaks.
 */
export const DEFAULT_ACCOUNT_ORIGIN = "https://app.pinext.dev";
