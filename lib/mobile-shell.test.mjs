// fork:mobile-shell —— 壳探测 / insets 覆盖 / 返回栈注册表
import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url, { moduleCache: false });
  return jiti.import("./mobile-shell.ts");
}

const {
  isMobileShell,
  nativePluginCall,
  applyShellInsets,
  pushBackHandler,
  popNativeBackStack,
} = await loadSubject();

/** 在 Node 里伪造浏览器全局（模块在调用时才读它们，测试可自由换装）。 */
function withBrowserGlobals(globals, run) {
  const saved = {};
  for (const key of Object.keys(globals)) {
    saved[key] = globalThis[key];
    if (globals[key] === undefined) delete globalThis[key];
    else globalThis[key] = globals[key];
  }
  try {
    return run();
  } finally {
    for (const key of Object.keys(globals)) {
      if (saved[key] === undefined) delete globalThis[key];
      else globalThis[key] = saved[key];
    }
  }
}

const noGlobals = { window: undefined, navigator: undefined, document: undefined };

test("没有 window（SSR/Node）→ 不在壳里", () => {
  withBrowserGlobals(noGlobals, () => {
    assert.equal(isMobileShell(), false);
  });
});

test("window.Capacitor.isNativePlatform() → 在壳里（主判据）", () => {
  withBrowserGlobals(
    {
      window: { Capacitor: { isNativePlatform: () => true } },
      navigator: { userAgent: "Mozilla/5.0 (Macintosh)" },
    },
    () => assert.equal(isMobileShell(), true),
  );
});

test("桌面浏览器 UA 且无 Capacitor → 不在壳里", () => {
  withBrowserGlobals(
    {
      window: {},
      navigator: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120 Safari/537.36" },
    },
    () => assert.equal(isMobileShell(), false),
  );
});

test("Android WebView UA（; wv)）兜底判为壳（防桥注入时序窗口）", () => {
  withBrowserGlobals(
    {
      window: {},
      navigator: {
        userAgent:
          "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120 Mobile Safari/537.36); wv)",
      },
    },
    () => assert.equal(isMobileShell(), true),
  );
});

test("nativePluginCall：无桥 / 插件拒绝 → null；有桥 → 返回值", async () => {
  await withBrowserGlobals(noGlobals, async () => {
    assert.equal(await nativePluginCall("Insets", "getSystemBars"), null);
  });
  await withBrowserGlobals(
    {
      window: {
        Capacitor: {
          nativePromise: (plugin, method) =>
            plugin === "Insets" && method === "getSystemBars"
              ? Promise.resolve({ top: 24, bottom: 16 })
              : Promise.reject(new Error("no plugin")),
        },
      },
    },
    async () => {
      assert.deepEqual(await nativePluginCall("Insets", "getSystemBars"), { top: 24, bottom: 16 });
      assert.equal(await nativePluginCall("Nope", "nope"), null);
    },
  );
});

test("applyShellInsets 把真数写进 --safe-*，缺的边不动", () => {
  const written = new Map();
  const root = { style: { setProperty: (k, v) => written.set(k, v) } };
  withBrowserGlobals({ document: { documentElement: root } }, () => {
    applyShellInsets({ top: 24, bottom: 16 });
    assert.equal(written.get("--safe-top"), "24px");
    assert.equal(written.get("--safe-bottom"), "16px");
    assert.equal(written.has("--safe-left"), false);
  });
});

test("返回栈：LIFO 消费，注销后不再被问到", () => {
  const calls = [];
  const unregisterA = pushBackHandler(() => {
    calls.push("A");
    return true;
  });
  const unregisterB = pushBackHandler(() => {
    calls.push("B");
    return true;
  });
  assert.equal(popNativeBackStack(), true);
  assert.deepEqual(calls, ["B"]); // 栈顶优先
  unregisterA();
  unregisterB(); // 栈是模块级的，必须清干净，否则污染后续用例
  assert.equal(popNativeBackStack(), false); // 空栈 → 没人消费（退到后台）
  assert.deepEqual(calls, ["B"]); // 注销后不再被问到
});

test("返回栈：栈顶不消费就问下一层；全不消费 → false（退到后台）", () => {
  const calls = [];
  const unregisterBottom = pushBackHandler(() => {
    calls.push("bottom");
    return true;
  });
  const unregisterTop = pushBackHandler(() => {
    calls.push("top");
    return false;
  });
  assert.equal(popNativeBackStack(), true);
  assert.deepEqual(calls, ["top", "bottom"]);
  unregisterTop();
  unregisterBottom();
  assert.equal(popNativeBackStack(), false);
});
