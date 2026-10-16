import type { CloudStore, Account } from "./store.ts";
import { escapeHtml, errorResponse, htmlResponse, page, readForm, redirectResponse } from "./http.ts";
import type { Devices } from "./devices.ts";

/**
 * The 控制台: which computers are on this account, and the way to take one off it.
 *
 * The desktop's account menu links here, and it is the only place a device can be deleted — which
 * matters because the device cap (409 `too_many_devices`) tells the person to come here. Removing
 * one also closes its signaling socket, so the machine learns immediately rather than when it next
 * reconnects.
 */
export class ConsolePage {
  #store: CloudStore;
  #devices: Devices;
  #session: (request: Request) => Promise<Account | null>;

  constructor(deps: { store: CloudStore; devices: Devices; session: (request: Request) => Promise<Account | null> }) {
    this.#store = deps.store;
    this.#devices = deps.devices;
    this.#session = deps.session;
  }

  async handle(request: Request, origin: string): Promise<Response | null> {
    const url = new URL(request.url);
    if (url.pathname === "/console" && request.method === "GET") return this.#list(request, origin);
    if (url.pathname === "/console/delete" && request.method === "POST") return this.#delete(request);
    return null;
  }

  async #list(request: Request, origin: string): Promise<Response> {
    const account = await this.#session(request);
    if (!account) {
      return htmlResponse(
        200,
        page(
          "管理设备",
          `<h1>管理设备</h1>
           <p>先登录，才能看到这个账号下的电脑。</p>
           <div class="row"><a class="btn primary" href="/auth/github/login?return=%2Fconsole">登录</a></div>`,
          { origin },
        ),
      );
    }

    const devices = this.#store.devicesOf(account.id);
    const rows = devices
      .map(
        (device) => `<li style="display:flex;align-items:center;gap:.75rem;padding:.6rem 0;border-top:1px solid #e4e4e7">
          <span style="flex:1;min-width:0">
            <strong style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(device.name)}</strong>
            <span class="muted" style="margin:0">${escapeHtml(device.platform || "unknown")}</span>
          </span>
          <form method="post" action="/console/delete">
            <input type="hidden" name="device_id" value="${escapeHtml(device.id)}">
            <button class="ghost" type="submit">移除</button>
          </form>
        </li>`,
      )
      .join("");

    return htmlResponse(
      200,
      page(
        "管理设备",
        `<h1>管理设备</h1>
         <p>${escapeHtml(account.login)} 的账号下有 ${devices.length} 台电脑。</p>
         ${devices.length === 0 ? `<p>还没有电脑登记过。</p>` : `<ul style="list-style:none;margin:0;padding:0">${rows}</ul>`}
         <p class="muted">移除一台电脑后，它会立即断开，需要在那台电脑上重新打开远程访问才会再次出现。</p>`,
        { origin },
      ),
    );
  }

  async #delete(request: Request): Promise<Response> {
    const account = await this.#session(request);
    if (!account) {
      return errorResponse(401, "unauthorized");
    }
    const form = await readForm(request).catch(() => ({}) as Record<string, string>);
    const deviceId = (form.device_id ?? "").trim();
    if (!deviceId) {
      return errorResponse(400, "invalid_request");
    }
    await this.#devices.remove(account.id, deviceId);
    return redirectResponse("/console");
  }
}
