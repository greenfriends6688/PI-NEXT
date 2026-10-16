import type { CloudConfig } from "./config.ts";
import type { CloudStore } from "./store.ts";
import { toWireUser } from "./login.ts";
import { bearer, errorResponse, jsonResponse, readJson } from "./http.ts";

/**
 * Device registration — how a phone learns which `device_id` to call.
 *
 * `install_id` is the desktop's own stable identity for this installation (`rtc-device.json`),
 * and the pairing is idempotent on `(account, install_id)`: renaming a computer or signing in
 * again must keep the same `device_id`, because that is the string the phone already saved and
 * the one a running desktop is addressed by.
 */

/** The contract's own pattern: printable ASCII, 8–64 characters. */
const INSTALL_ID = /^[\x21-\x7e]{8,64}$/;

export type DeviceRoutesDeps = {
  config: CloudConfig;
  store: CloudStore;
  /** Live signaling sockets decide this — there is no separate heartbeat endpoint. */
  isOnline: (deviceId: string) => boolean;
  /** Called when a device is removed, so its signaling socket can be closed with 4005. */
  onDeviceRemoved?: (deviceId: string) => void;
};

export class Devices {
  #deps: DeviceRoutesDeps;

  constructor(deps: DeviceRoutesDeps) {
    this.#deps = deps;
  }

  async handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    if (url.pathname === "/api/devices/me" && request.method === "PUT") return this.#register(request);
    if (url.pathname === "/api/devices" && request.method === "GET") return this.#list(request);
    return null;
  }

  /** Remove a device on the account's behalf (the 控制台). */
  async remove(accountId: string, deviceId: string): Promise<boolean> {
    const device = this.#deps.store.device(deviceId);
    if (!device || device.accountId !== accountId) return false;
    await this.#deps.store.removeDevice(deviceId);
    // The socket is closed with a code the desktop reads as "you were removed, stop": without
    // it the machine would keep a socket the account no longer knows about, and the phone would
    // reach a device that is not in its list.
    this.#deps.onDeviceRemoved?.(deviceId);
    return true;
  }

  async #register(request: Request): Promise<Response> {
    const account = await this.#account(request);
    if (!account) {
      return errorResponse(401, "unauthorized");
    }
    const body = await readJson(request).catch(() => ({}) as Record<string, unknown>);
    const installId = typeof body.install_id === "string" ? body.install_id : "";
    const name = typeof body.name === "string" ? body.name.slice(0, 80).trim() : "";
    const platform = typeof body.platform === "string" ? body.platform.slice(0, 32) : "";
    if (!INSTALL_ID.test(installId) || !name) {
      return errorResponse(400, "invalid_request");
    }

    // The cap is checked before the upsert, so a rename of an already-registered device is
    // never the request that hits it.
    const known = this.#deps.store.devicesOf(account.id).some((item) => item.installId === installId);
    if (!known && this.#deps.store.deviceCount(account.id) >= this.#deps.config.maxDevicesPerAccount) {
      // 409 rather than 400: the client shows "delete a device in the console" and does not
      // retry, so this must not look like a transient failure.
      return errorResponse(409, "too_many_devices");
    }

    const device = await this.#deps.store.upsertDevice({ accountId: account.id, installId, name, platform });
    return jsonResponse(200, { device: { id: device.id, name: device.name } });
  }

  async #list(request: Request): Promise<Response> {
    const account = await this.#account(request);
    if (!account) {
      return errorResponse(401, "unauthorized");
    }
    return jsonResponse(200, {
      user: toWireUser(account),
      devices: this.#deps.store.devicesOf(account.id).map((device) => ({
        id: device.id,
        name: device.name,
        platform: device.platform,
        online: this.#deps.isOnline(device.id),
      })),
    });
  }

  async #account(request: Request) {
    const token = bearer(request);
    const verified = token ? await this.#deps.store.verifyToken(token, this.#deps.config.tokenTtlMs) : null;
    return verified && !verified.account.disabled ? verified.account : null;
  }
}
