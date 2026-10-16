import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCloud } from "../services/cloud/src/node/server.ts";
import { AccountService } from "../src/main/engine/account.ts";
import type { AccountState } from "../src/shared/account.ts";
import type { CloudConfig } from "../services/cloud/src/config.ts";

/**
 * The desktop's own sign-in, against **this repository's** cloud service rather than a stand-in.
 *
 * `test/account.test.ts` checks the client against a fake that was written from the same reading
 * of the contract, so the two agree by construction. This one runs the real client against the
 * real service, which is the only arrangement that can catch the two sides disagreeing about a
 * field name, a status code or the exact `redirect_uri` — and per
 * `docs/pinext-cloud-deploy-checklist-2026-10-15.md` the contract and the client really did
 * disagree in eight places.
 *
 * The "browser" is a function that does what a person does: it opens the page, presses 允许, and
 * ends up at the app's loopback listener with a code.
 */

function configFor(dir: string): CloudConfig {
  return {
    port: 0,
    host: "127.0.0.1",
    publicOrigin: "http://127.0.0.1",
    dataFile: join(dir, "cloud.json"),
    tokenTtlMs: 90 * 24 * 60 * 60 * 1000,
    codeTtlMs: 5 * 60 * 1000,
    sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
    github: null,
    devLogin: true,
    maxDevicesPerAccount: 10,
    stunUrls: ["stun:example.test:3478"],
    turn: null,
    relayLimit: 4,
  };
}

/**
 * Stand in for the browser: open the sign-in page, approve it, follow the redirect.
 *
 * Only the URLs the page would navigate to are followed — the form is submitted the way the
 * `<form method="post" action="/authorize/decision">` on it does, with the parameters the page
 * carried through as hidden inputs.
 */
async function browse(authorize: URL, login: string): Promise<void> {
  const page = await fetch(authorize);
  assert.equal(page.status, 200, "the sign-in page should render");
  const html = await page.text();
  assert.match(html, /authorize\/decision/, "the page should carry the decision form");
  assert.match(html, /dev_account/, "development sign-in should be offered");

  const form = new URLSearchParams(authorize.searchParams);
  form.set("decision", "allow");
  form.set("dev_login", "1");
  form.set("dev_account", login);
  const decision = await fetch(new URL("/authorize/decision", authorize.origin), { method: "POST", body: form, redirect: "manual" });
  assert.equal(decision.status, 302, "approving should redirect back");

  // What the browser does next, and the whole point of the loopback listener.
  const back = decision.headers.get("location");
  assert.ok(back, "the redirect should have a location");
  const landed = await fetch(back);
  assert.equal(landed.status, 200, "the desktop's listener should answer the browser");
}

test("桌面端连真实云服务：完整登录流程走通", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pinext-cloud-e2e-"));
  const cloud = await createCloud(configFor(dir));
  const address = await cloud.listen();
  const origin = `http://127.0.0.1:${address.port}`;

  const states: AccountState[] = [];
  let signedIn = 0;
  let opened: URL | null = null;

  const service = new AccountService({
    file: join(dir, "account.json"),
    origin,
    platform: "darwin",
    deviceName: () => "Ada's MacBook",
    onChange: (state) => states.push(state),
    onSignedIn: () => {
      signedIn += 1;
    },
    openUrl: (url) => {
      // The person takes their time; the callback arrives after `login()` has returned, which is
      // the case the client has to survive.
      opened = new URL(url);
      setTimeout(() => void browse(opened!, "octocat").catch(() => undefined), 5);
    },
  });

  try {
    await service.login();

    let state = service.state();
    for (let i = 0; i < 400 && state.status !== "signed-in"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      state = service.state();
    }
    assert.equal(state.status, "signed-in", `never signed in; stuck at ${state.status}`);
    assert.equal(state.user?.login, "octocat");
    assert.equal(signedIn, 1, "the signed-in callback fires once");

    // What the desktop actually sent: the parameters the service is written against, including
    // the PKCE challenge it must verify and the loopback redirect it must bind the code to.
    assert.ok(opened, "the browser should have been opened");
    const sent = opened as unknown as URL;
    assert.equal(sent.pathname, "/authorize");
    assert.equal(sent.searchParams.get("client_id"), "pinext-desktop");
    assert.equal(sent.searchParams.get("code_challenge_method"), "S256");
    assert.equal(sent.searchParams.get("device_name"), "Ada's MacBook");
    assert.equal(sent.searchParams.get("platform"), "darwin");
    assert.match(sent.searchParams.get("redirect_uri") ?? "", /^http:\/\/127\.0\.0\.1:\d+\/callback$/, "redirect 必须是回环监听");
    assert.match(sent.searchParams.get("code_challenge") ?? "", /^[A-Za-z0-9_-]{43}$/);

    // The token the service issued is what the client stored and what keeps it signed in.
    const token = service.token();
    assert.ok(token, "a token should be stored");
    const me = await fetch(new URL("/api/me", origin), { headers: { authorization: `Bearer ${token}` } });
    assert.equal(me.status, 200, "the stored token should still be accepted");

    // Signing out revokes it: the next call is 401, which is what tells a client to drop it.
    await service.logout();
    const after = await fetch(new URL("/api/me", origin), { headers: { authorization: `Bearer ${token}` } });
    assert.equal(after.status, 401, "登出后令牌必须失效");
  } finally {
    await cloud.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("桌面端把设备登记进真实云服务，手机能看到它在线与否", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pinext-cloud-dev-"));
  const cloud = await createCloud(configFor(dir));
  const address = await cloud.listen();
  const origin = `http://127.0.0.1:${address.port}`;

  try {
    // Sign in through the same flow, then register the way `OfficialConnection` does: the id it
    // keeps in `rtc-device.json`, on every reconnect and every rename.
    let opened: URL | null = null;
    const service = new AccountService({
      file: join(dir, "account.json"),
      origin,
      platform: "darwin",
      deviceName: () => "Ada's MacBook",
      onChange: () => undefined,
      openUrl: (url) => {
        opened = new URL(url);
        setTimeout(() => void browse(opened!, "octocat").catch(() => undefined), 5);
      },
    });
    await service.login();
    for (let i = 0; i < 400 && service.state().status !== "signed-in"; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(service.state().status, "signed-in");

    const token = service.token()!;
    const installId = "inst_0123456789abcdef0123456789abcdef";
    const register = (name: string) =>
      fetch(new URL("/api/devices/me", origin), {
        method: "PUT",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ install_id: installId, name, platform: "darwin" }),
      }).then((response) => response.json() as Promise<{ device: { id: string; name: string } }>);

    const first = await register("Ada's MacBook");
    const renamed = await register("Ada's MacBook Pro");
    assert.equal(renamed.device.id, first.device.id, "改名不改 device_id");
    assert.equal(renamed.device.name, "Ada's MacBook Pro");

    const listed = (await (await fetch(new URL("/api/devices", origin), { headers: { authorization: `Bearer ${token}` } })).json()) as {
      devices: Array<{ id: string; name: string; platform: string; online: boolean }>;
    };
    assert.equal(listed.devices.length, 1);
    assert.equal(listed.devices[0]?.id, first.device.id);
    assert.equal(listed.devices[0]?.platform, "darwin");
    assert.equal(listed.devices[0]?.online, false, "没有信令连接时不在线");
  } finally {
    await cloud.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
