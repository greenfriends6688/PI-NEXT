import { createHmac } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CloudConfig } from "./config.ts";
import { sendJson } from "./http.ts";

/**
 * What ICE servers a client should gather with.
 *
 * STUN answers "what is my address as the internet sees it", and is all a direct path needs.
 * TURN relays the call when there is no direct path at all — symmetric NAT on both ends, which
 * mobile data and carrier-grade NAT produce routinely — and is the one part of this service that
 * costs real money per byte.
 *
 * The credentials are derived, not stored: `username` is `<expiry>:<account>`, and coturn
 * computes the same password from the same shared secret. Nothing has to be provisioned per
 * user, and an expired credential stops working by itself rather than staying valid until
 * somebody remembers to revoke it.
 */
export class Ice {
  #config: CloudConfig;

  constructor(config: CloudConfig) {
    this.#config = config;
  }

  handle(request: IncomingMessage, response: ServerResponse, url: URL, accountId: string | null): boolean {
    if (url.pathname !== "/api/rtc/ice") return false;
    const servers: Array<Record<string, unknown>> = [];

    if (this.#config.stunUrls.length > 0) servers.push({ urls: this.#config.stunUrls });

    const turn = this.#config.turn;
    if (turn && accountId) {
      const expiresAt = Math.floor(Date.now() / 1000) + turn.ttlSeconds;
      const username = `${expiresAt}:${accountId}`;
      servers.push({
        urls: turn.urls,
        username,
        // coturn's `use-auth-secret`: base64(HMAC-SHA1(shared secret, username)). The alphabet
        // includes `+ / =`, which is why this travels as a JSON field and never in a URL.
        credential: createHmac("sha1", turn.secret).update(username).digest("base64"),
      });
      // Handed back so a client can refresh before the credential dies: a relayed call that
      // outlives its credential is dropped mid-conversation.
      sendJson(response, 200, { ice_servers: servers, expires_at: new Date(expiresAt * 1000).toISOString() });
      return true;
    }

    // No TURN configured: STUN only. Direct and hole-punched paths still work, which covers the
    // same network and most home broadband; the cases it does not cover are the reason the
    // contract calls TURN optional rather than required.
    sendJson(response, 200, { ice_servers: servers });
    return true;
  }
}
