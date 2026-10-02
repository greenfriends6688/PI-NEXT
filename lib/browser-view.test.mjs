import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  browserSurfaceHint,
  callBrowserHostBridge,
  detectBrowserHostSessionId,
  detectBrowserSurface,
  notifyBrowserHostBridge,
  supportsManagedBrowser,
} = await jiti.import("./browser-view.ts");

/** 装一个假的桌面桥（组件只认 window.piWebDesktop 这一个存在性判据）。 */
function withBridge(bridge, run) {
  const had = "piWebDesktop" in globalThis.window;
  const previous = globalThis.window.piWebDesktop;
  globalThis.window.piWebDesktop = bridge;
  try {
    run();
  } finally {
    if (had) globalThis.window.piWebDesktop = previous;
    else delete globalThis.window.piWebDesktop;
  }
}

globalThis.window ??= /** @type {any} */ ({});

test("Web（无桥）一律退化成 iframe —— 这是「别为了桌面壳把 Web 弄坏」的最后一道保险", () => {
  withBridge(undefined, () => {
    assert.equal(detectBrowserSurface(), "iframe");
    assert.equal(supportsManagedBrowser(), false);
  });
});

test("在桌面壳里但主进程没注册 browser 控制面，也退化而不是白屏", () => {
  withBridge({ version: 1, platform: "darwin", notify: () => Promise.resolve(true) }, () => {
    assert.equal(detectBrowserSurface(), "iframe");
    assert.equal(supportsManagedBrowser(), false);
  });
});

test("桌面壳 + 注册了控制面 = 受管浏览器", () => {
  withBridge({ version: 1, platform: "darwin", browser: { layout: () => {} } }, () => {
    assert.equal(detectBrowserSurface(), "managed");
    assert.equal(supportsManagedBrowser(), true);
  });
});

test("宿主调用失败一律变成 { ok: false }，不让异常冒到渲染层", async () => {
  withBridge({ version: 1, browser: {} }, async () => {
    assert.deepEqual(await callBrowserHostBridge("getState", ["s1"]), {
      ok: false,
      reason: "当前宿主没有注册浏览器控制面。",
    });
  });
  withBridge({ version: 1, browser: { getState: () => Promise.reject(new Error("boom")) } }, async () => {
    assert.deepEqual(await callBrowserHostBridge("getState", ["s1"]), { ok: false, reason: "boom" });
  });
});

test("notify 版本吞掉异常（布局通知失败只影响贴图位置）", () => {
  withBridge({
    version: 1,
    browser: {
      layout: () => {
        throw new Error("no window");
      },
    },
  }, () => {
    assert.doesNotThrow(() => notifyBrowserHostBridge("layout", ["s1", { x: 0, y: 0, width: 1, height: 1 }]));
  });
});

test("宿主会话 id 优先用聊天会话；拿不到才退回面板 id（不把目录名拼进 profile 哈希）", () => {
  assert.equal(detectBrowserHostSessionId("abc-123"), "session:abc-123");
  assert.equal(detectBrowserHostSessionId(undefined, "tab-9"), "panel:tab-9");
  assert.equal(detectBrowserHostSessionId("   "), "panel:default");
});

test("提示文案随宿主切换", () => {
  const t = (key) => key;
  assert.equal(browserSurfaceHint("managed", t), "browser.managedActive");
  assert.equal(browserSurfaceHint("iframe", t), "browser.iframeFallbackHint");
});