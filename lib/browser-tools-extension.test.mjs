import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  BROWSER_RISK_ENTRY_TYPE,
  BROWSER_TOOL_NAMES,
  HOST_BROWSER_EXTENSION_NAME,
  createBrowserToolsExtension,
  formatObserveLines,
  readBrowserRiskFromBranch,
} = await jiti.import("./browser-tools-extension.ts");
const { BROWSER_HOST_OPS } = await jiti.import("./browser-host-protocol.ts");

/** 一个假的 ExtensionAPI：把注册到的工具收起来，供断言形状用。 */
function collectTools(extension) {
  const tools = [];
  const handlers = [];
  extension.factory({
    on: (name, handler) => handlers.push({ name, handler }),
    registerTool: (tool) => tools.push(tool),
    appendEntry: () => {},
  });
  return { tools, handlers };
}

function fakeContext(overrides = {}) {
  return {
    ui: { confirm: async () => true },
    hasUI: true,
    cwd: "/repo",
    signal: undefined,
    sessionManager: {
      getSessionId: () => "session-1",
      getBranch: () => [],
    },
    ...overrides,
  };
}

test("扩展的形状：名字、hidden、恰好 10 个工具", () => {
  const extension = createBrowserToolsExtension();
  assert.equal(extension.name, HOST_BROWSER_EXTENSION_NAME);
  assert.equal(extension.hidden, true);
  const { tools, handlers } = collectTools(extension);
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [...BROWSER_TOOL_NAMES].sort());
  assert.equal(tools.length, 10);
  assert.deepEqual(handlers.map((handler) => handler.name).sort(), ["session_start", "session_tree"]);
});

test("每个工具都有 label / description / 参数 schema，且没有执行脚本的工具", () => {
  const { tools } = collectTools(createBrowserToolsExtension());
  for (const tool of tools) {
    assert.ok(tool.label, tool.name);
    assert.ok(tool.description.length > 10, tool.name);
    assert.equal(typeof tool.parameters, "object", tool.name);
    assert.equal(typeof tool.execute, "function", tool.name);
  }
  assert.equal(
    tools.some((tool) => /execute.?javascript|eval|run.?script/i.test(tool.name)),
    false,
    "协议里没有 executeJavaScript：原子工具优先",
  );
});

test("导航工具同时接受 url 与 localPath，但两者都不强制（缺一时报自己的错）", () => {
  const { tools } = collectTools(createBrowserToolsExtension());
  const navigate = tools.find((tool) => tool.name === "browser_navigate");
  const properties = navigate.parameters.properties ?? {};
  assert.deepEqual(Object.keys(properties).sort(), ["localPath", "tabId", "url"]);
  assert.equal(navigate.parameters.required, undefined);
});

test("点击 / 输入必须带 ref（ref 是模型唯一的抓手，不能省）", () => {
  const { tools } = collectTools(createBrowserToolsExtension());
  const click = tools.find((tool) => tool.name === "browser_click");
  assert.deepEqual(click.parameters.required, ["ref"]);
  const type = tools.find((tool) => tool.name === "browser_type");
  assert.deepEqual(type.parameters.required, ["ref", "text"]);
});

test("风险门：没有 UI 时一律拦下，不默默放行", async () => {
  const calls = [];
  const extension = createBrowserToolsExtension({
    callHost: async (op) => {
      calls.push(op);
      return { tabId: "tab-1", url: "https://example.com/", title: "x", elements: [] };
    },
  });
  const { tools } = collectTools(extension);
  const observe = tools.find((tool) => tool.name === "browser_observe");
  await assert.rejects(
    () => observe.execute("call-1", {}, undefined, undefined, fakeContext({ hasUI: false })),
    /风险提示/,
  );
  assert.deepEqual(calls, []);
});

test("风险门：用户确认后才放行，且确认写进会话条目", async () => {
  const appended = [];
  const calls = [];
  const extension = createBrowserToolsExtension({
    callHost: async (op) => {
      calls.push(op);
      return { tabId: "tab-1", url: "https://example.com/", title: "x", elements: [] };
    },
  });
  const tools = [];
  extension.factory({
    on: () => {},
    registerTool: (tool) => tools.push(tool),
    appendEntry: (type, data) => appended.push({ type, data }),
  });
  const observe = tools.find((tool) => tool.name === "browser_observe");
  /* fork:ext-i18n-keys —— 确认框只发 title + body，不再拼 `[accept] / [deny]`：
     那串括号在渲染端翻不出来（用户实拍就是一行原始 key），而对话框底部本来就有
     「取消 / 确认」两枚钮。 */
  const confirmArgs = [];
  const result = await observe.execute("call-1", {}, undefined, undefined, fakeContext({
    ui: { confirm: async (title, message) => { confirmArgs.push([title, message]); return true; } },
  }));
  assert.equal(confirmArgs.length, 1);
  assert.doesNotMatch(confirmArgs[0][1], /\[/);
  assert.equal(calls.length >= 1, true);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].type, BROWSER_RISK_ENTRY_TYPE);
  assert.equal(appended[0].data.state, "acknowledged");
  assert.ok(Array.isArray(result.content));
});

test("风险门：用户拒绝后不再重复弹窗", async () => {
  const calls = [];
  const extension = createBrowserToolsExtension({
    callHost: async (op) => {
      calls.push(op);
      return { tabId: "tab-1", url: "", title: "", elements: [] };
    },
    riskText: { title: "t", body: "b", accept: "yes", deny: "no" },
  });
  const tools = [];
  extension.factory({ on: () => {}, registerTool: (tool) => tools.push(tool), appendEntry: () => {} });
  const observe = tools.find((tool) => tool.name === "browser_observe");
  const denied = fakeContext({ ui: { confirm: async () => false } });
  await assert.rejects(() => observe.execute("call-1", {}, undefined, undefined, denied), /拒绝/);
  assert.deepEqual(calls, []);
  await assert.rejects(() => observe.execute("call-2", {}, undefined, undefined, denied), /已拒绝/);
});

test("observe 的输出带世代号与 ref 行", () => {
  const lines = formatObserveLines([
    { ref: "r2-1", role: "button", name: "登录", editable: false },
    { ref: "r2-2", role: "textbox", name: "", editable: true },
  ]);
  assert.equal(lines, 'r2-1 button 「登录」\nr2-2 textbox [可输入]');
});

test("风险确认从分支里的 custom entry 读回，其它条目一律忽略", () => {
  assert.deepEqual(
    readBrowserRiskFromBranch([
      { type: "message", message: { role: "toolResult", toolName: "x" } },
      { type: "custom", customType: "pi-web:tool-grants", data: { version: 1, grants: [] } },
    ]),
    null,
  );
  assert.deepEqual(
    readBrowserRiskFromBranch([
      { type: "custom", customType: "pi-web:tool-selection", data: { version: 1 } },
      { type: "custom", customType: BROWSER_RISK_ENTRY_TYPE, data: { state: "denied" } },
    ]),
    { state: "denied" },
  );
});

test("协议面：10 个工具都用得到，且没有裸脚本 op", () => {
  const used = BROWSER_TOOL_NAMES.map((name) => name.replace(/^browser_/, ""));
  for (const op of ["navigate", "observe", "click", "type", "scroll", "extract", "screenshot", "newTab", "switchTab", "closeTab"]) {
    assert.ok(BROWSER_HOST_OPS.includes(op), op);
    assert.ok(used.length > 0);
  }
  assert.equal(BROWSER_HOST_OPS.includes("executeScript"), false);
});