/**
 * What a Worker is handed: the two Durable Object namespaces and the configured variables.
 *
 * Declared here rather than pulled from a generated `worker-configuration.d.ts`, because this
 * repository typechecks with `tsc` and a generated file would have to be produced first — and a
 * typecheck that depends on having run another command is one that gets skipped.
 *
 * Everything besides the bindings is a **string**, because that is what a `vars` block and a
 * `secret` both are. `loadConfig` reads them by the same names the Node host reads from its
 * environment, so the two hosts are configured by one vocabulary.
 */
export type CloudEnv = {
  /** The single object holding accounts, token hashes and devices. */
  STORE: DurableObjectNamespace;
  /** One per account, holding that account's signaling sockets. */
  SIGNAL: DurableObjectNamespace;

  PUBLIC_ORIGIN?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  DEV_LOGIN?: string;
  MAX_DEVICES?: string;
  TOKEN_TTL_DAYS?: string;
  CODE_TTL_SECONDS?: string;
  STUN_URLS?: string;
  TURN_SECRET?: string;
  TURN_URLS?: string;
  TURN_TTL_SECONDS?: string;
  RELAY_LIMIT?: string;
  /** Present so `loadConfig` can read the same object it reads on Node; unused here. */
  DATA_FILE?: string;
  PORT?: string;
  HOST?: string;
};
