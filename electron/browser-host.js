"use strict";

// fork:proma-42-browser · 受管浏览器的 Electron 宿主。
//
// 这是本仓「Electron 有 / Web 没有」那一半的实现：真正的浏览器视图（`WebContentsView`）、
// 按会话隔离并持久化在本机的 profile、CDP 输入与无障碍树读取、后台会话与标签的
// 生命周期。Web 那一半在 `lib/browser-view.ts`（iframe 退化路径），两半分叉只发生在
// 那一处，本文件不参与。
//
// 这个宿主是**执行器，不是决策者**：
//   · URL 能不能导航、ref 有没有过期、回收谁、风险确认没确认 —— 全部在 Next 服务侧
//     （lib/browser-url-policy.ts / browser-ref-store.ts / browser-capacity.ts /
//     browser-risk-gate.ts），宿主只做最后一道 fail-closed 复查。
//   · 唯一的「宿主自己决定」是把服务端算好的决策落到 WebContents 上。
//
// 接线（PR-42a 集成时加，本任务不改 electron/main.js）：
//   const { createBrowserHost } = require("./browser-host");
//   const browserHost = createBrowserHost({ getWindow: () => mainWindow, serverOrigin: () => `http://127.0.0.1:${serverPort}` });
//   await browserHost.start();
//   browserHost.attach(mainWindow);          // 在 createWindow 里，窗口就绪后
//   app.on("will-quit", () => browserHost.stop());

const crypto = require("node:crypto");
const { startBrowserHostServer } = require("./browser-host-server");

/** 与 lib/browser-capacity.ts 的常量一致（那边是可测的权威值，这里是运行期副本）。 */
const CDP_COMMAND_TIMEOUT_MS = 8_000;
const OBSERVE_TIMEOUT_MS = 5_000;
const NAVIGATE_TIMEOUT_MS = 8_000;
const MAX_SCREENSHOT_BYTES = 3 * 1024 * 1024;
const MAX_TEXT_INPUT_CHARS = 10_000;
const MAX_SCROLL_DELTA = 50_000;
const MAX_TABS = 20;
const DEFAULT_AX_DEPTH = 8;
const MAX_AX_NODES = 20_000;

const INTERACTIVE_AX_ROLES = new Set([
  "button", "checkbox", "combobox", "gridcell", "link", "listbox", "menuitem",
  "menuitemcheckbox", "menuitemradio", "option", "radio", "searchbox", "slider",
  "spinbutton", "switch", "tab", "textbox", "treeitem",
]);

const NAVIGATION_KEY_CODES = {
  Enter: { code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Tab: { code: "Tab", windowsVirtualKeyCode: 9, text: "\t" },
  Escape: { code: "Escape", windowsVirtualKeyCode: 27, text: "" },
};

/**
 * 宿主这一侧的 URL 复查：只认 http/https，**永远不认 file://**。
 *
 * 这一段刻意与服务端的 `lib/browser-url-policy.ts` 重复：两边的信任等级不同 ——
 * 服务端那道是「agent 的输入要合法」，这道是「这个进程发起的每一次导航都必须合法」。
 * 只做协议判定（不做公网/私网分类）：分类是策略，协议是安全边界。
 */
function assertHostNavigableUrl(input) {
  const value = String(input ?? "").trim();
  if (!value) throw hostError("地址为空。", "navigate-failed");
  const explicit = /^([a-zA-Z][a-zA-Z\d+.-]*):/.exec(value);
  const scheme = (explicit ? explicit[1] : "https").toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    throw hostError(`只允许 http/https 地址，收到 ${scheme}: 。`, "navigate-failed");
  }
  let parsed;
  try {
    parsed = new URL(explicit ? value : `https://${value}`);
  } catch {
    throw hostError("地址无效。", "navigate-failed");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw hostError(`只允许 http/https 地址，收到 ${parsed.protocol}。`, "navigate-failed");
  }
  if (!parsed.hostname) throw hostError("地址缺少主机名。", "navigate-failed");
  return parsed.toString();
}

function hostError(message, code) {
  const error = new Error(message);
  error.code = code || "host-error";
  return error;
}

function textOf(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && typeof value.value === "string") return value.value.trim();
  return "";
}

function axBoolean(ax, name) {
  const properties = Array.isArray(ax.properties) ? ax.properties : [];
  return properties.some((property) => property && typeof property === "object"
    && property.name === name && property.value && property.value.value === true);
}

/** contenteditable 会被表示成 editable=true，也可能是 token: richtext/plaintext。 */
function axEditable(ax) {
  const properties = Array.isArray(ax.properties) ? ax.properties : [];
  return properties.some((property) => {
    if (!property || typeof property !== "object" || property.name !== "editable") return false;
    const value = property.value && property.value.value;
    return value === true || (typeof value === "string" && value !== "" && value !== "false");
  });
}

/**
 * profile 分区：按**工作区**隔离持久化在本机（`session.fromPartition("persist:…")`）。
 * 哈希掉标识，避免把会话 id / 目录名写进磁盘上的分区名。持久化 partition 只写
 * Electron 的 userData，永不外发；会话之间因此不共享 cookie。
 */
function persistentPartition(profileKey) {
  const digest = crypto.createHash("sha256").update(String(profileKey)).digest("hex").slice(0, 32);
  return `persist:pi-web-browser-${digest}`;
}

/**
 * 创建宿主。
 *
 * @param electron   Electron 模块（不顶层 require，便于测试与多版本兼容）。
 * @param options.getWindow     () => BrowserWindow | null
 * @param options.serverOrigin () => 应用自己的 loopback origin（本地预览用）
 * @param options.endpointPath  端点描述文件路径
 */
function createBrowserHost(electron, options) {
  const { WebContentsView } = electron;
  const getWindow = options.getWindow || (() => null);
  const serverOrigin = options.serverOrigin || (() => null);
  const endpointPath = options.endpointPath;

  /** sessionId → 会话记录。 */
  const sessions = new Map();
  let server = null;
  let attachCount = 0;
  let emitState = () => {};

  const now = () => Date.now();

  function createTabRecord(browserSession, { openedByAgent = false, partition }) {
    const view = new WebContentsView({
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // 受管浏览器不弹权限框：通知 / 摄像头 / 定位 / 剪贴板一律拒。
        // 站点识别为自动化本来就更容易撞风控，这里不再额外叠加手势。
        spellcheck: false,
      },
    });
    const tab = {
      tabId: crypto.randomBytes(8).toString("hex"),
      view,
      session: null,
      debuggerAttached: false,
      generation: 0,
      // backendNodeId 表由服务端世代管理驱动；宿主物理再存一份，
      // 导航 / 关闭 / debugger 重连时立刻清空 —— 服务端说作废，这里就真的作废。
      refs: new Map(),
      state: { url: "", title: "", loading: false },
      lastActivityAt: now(),
      openedByAgent,
      visible: false,
      attachedTo: null,
      bounds: null,
      isLocalPreview: false,
      disposeInFlight: false,
    };
    installTabGuards(tab, browserSession);
    return tab;
  }

  function attachSession(browserSession) {
    const owner = getWindow();
    if (!owner || owner.isDestroyed()) return;
    for (const tab of browserSession.tabs.values()) {
      if (!tab.visible) continue;
      try {
        if (tab.attachedTo !== owner) {
          owner.contentView.addChildView(tab.view);
          tab.attachedTo = owner;
        }
        if (tab.bounds) tab.view.setBounds(tab.bounds);
        tab.view.setVisible(true);
      } catch {
        // 视图已经被窗口销毁带走：只解绑，不抛 —— 生命周期竞态不该升级成主进程异常。
        tab.attachedTo = null;
      }
    }
  }

  function detachTab(tab) {
    try {
      const owner = tab.attachedTo;
      if (owner && !owner.isDestroyed()) owner.contentView.removeChildView(tab.view);
    } catch {
      /* 已经被移除 */
    }
    tab.attachedTo = null;
    if (!tab.view.webContents.isDestroyed()) {
      try {
        tab.view.setVisible(false);
      } catch {
        /* WebContents 已销毁 */
      }
    }
  }

  /** tab 的底层 Session：权限、网络与下载的边界都在这里装，且**只装一次**。 */
  function ensureTabSession(tab) {
    if (tab.session) return tab.session;
    const partition = tab.view.webContents.session;
    tab.session = partition;
    if (partition.__piWebBrowserGuarded) return partition;
    partition.__piWebBrowserGuarded = true;

    // 1. 权限全拒。
    partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    partition.setPermissionCheckHandler(() => false);

    // 2. 导航拦截：非 http(s) 直接取消（这是 file:// 的最后一道）。
    partition.webRequest.onBeforeRequest((details, callback) => {
      let protocol = "";
      try {
        protocol = new URL(details.url).protocol;
      } catch {
        callback({ cancel: true });
        return;
      }
      if (protocol !== "http:" && protocol !== "https:") {
        callback({ cancel: true });
        return;
      }
      callback({ cancel: false });
    });

    // 3. 下载默认取消：受管浏览器的下载不走用户可见的下载流程，
    //    放行等于让页面往磁盘任意位置写文件。用户在地址栏手动打开另说。
    partition.on("will-download", (_event, item) => item.cancel());

    return partition;
  }

  function installTabGuards(tab, browserSession) {
    const contents = tab.view.webContents;

    // window.open / target=_blank：默认拒。本仓的受管浏览器靠 browser_new_tab
    // 显式开标签，不接受页面自己开的窗（那是一条不受控的视图创建路径）。
    contents.setWindowOpenHandler(() => ({ action: "deny" }));

    // 导航换文档 → 这一代 ref 全部作废。顺序很重要：先作废，再更新状态。
    const invalidate = (reason) => {
      tab.refs.clear();
      tab.generation += 1;
      tab.lastActivityAt = now();
      void reason;
    };
    for (const event of ["did-start-navigation", "did-navigate", "did-navigate-in-page"]) {
      contents.on(event, () => {
        invalidate("navigate");
        syncState(tab, browserSession);
      });
    }
    for (const event of ["did-start-loading", "did-stop-loading"]) {
      contents.on(event, () => {
        tab.state.loading = event === "did-start-loading";
        syncState(tab, browserSession);
      });
    }
    contents.on("page-title-updated", (_event, title) => {
      tab.state.title = title;
      syncState(tab, browserSession);
    });
    contents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
      if (!isMainFrame) return;
      tab.state.loading = false;
      syncState(tab, browserSession);
      if (code === -3) return; // ERR_ABORTED：通常是本页自己跳走了
      trace(browserSession, tab, "navigate", `页面加载失败：${description || code}`, "failed");
    });
    contents.on("render-process-gone", (_event, details) => {
      // 渲染进程没了之后 debugger 一定失效：这一代 ref 不能留（backendNodeId 已无意义）。
      invalidate("debugger-recovered");
      tab.debuggerAttached = false;
      trace(browserSession, tab, "navigate", `页面进程已退出：${details && details.reason}`, "failed");
    });
    // 会话被整体关闭时（LRU 回收）同步清理。
    contents.once("destroyed", () => {
      invalidate("tab-closed");
    });
  }

  function syncState(tab, browserSession) {
    try {
      tab.state.url = tab.view.webContents.getURL() || "";
      tab.state.title = tab.view.webContents.getTitle() || "";
    } catch {
      /* WebContents 已销毁 */
    }
    browserSession.lastActivityAt = now();
    emitState();
  }

  /** 宿主只把无法归类的错误打到主进程日志；动作账本在服务端（工具结果就是 UI 的真相来源）。 */
  function trace(_browserSession, tab, action, message, level) {
    if (level !== "failed") return;
    console.error(`[受管浏览器] ${action} 失败（${tab.tabId}）：${message}`);
  }

  // ── 会话 ────────────────────────────────────────────────────────────────

  function createSession(sessionId, profileKey) {
    const partition = persistentPartition(profileKey || `session:${sessionId}`);
    const browserSession = {
      sessionId,
      partition,
      profileKey: profileKey || `session:${sessionId}`,
      tabs: new Map(),
      activeTabId: null,
      agentTabId: null,
      activeOperationCount: 0,
      preserveOnHide: false,
      lastActivityAt: now(),
      ledger: [],
    };
    sessions.set(sessionId, browserSession);
    return browserSession;
  }

  function getSession(sessionId, create = true) {
    let browserSession = sessions.get(sessionId);
    if (!browserSession && create) browserSession = createSession(sessionId);
    return browserSession || null;
  }

  function disposeTab(browserSession, tab) {
    if (!browserSession.tabs.has(tab.tabId)) return;
    browserSession.tabs.delete(tab.tabId);
    tab.refs.clear();
    try {
      if (tab.view.webContents.debugger.isAttached()) tab.view.webContents.debugger.detach();
    } catch {
      /* 已销毁 */
    }
    detachTab(tab);
    try {
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    } catch {
      /* 已销毁 */
    }
    if (browserSession.activeTabId === tab.tabId) browserSession.activeTabId = null;
    if (browserSession.agentTabId === tab.tabId) browserSession.agentTabId = null;
  }

  function closeSession(sessionId) {
    const browserSession = sessions.get(sessionId);
    if (!browserSession) return;
    for (const tab of [...browserSession.tabs.values()]) disposeTab(browserSession, tab);
    sessions.delete(sessionId);
    emitState();
  }

  function sessionSummary(browserSession) {
    return {
      sessionId: browserSession.sessionId,
      lastActivityAt: browserSession.lastActivityAt,
      hasPresentation: attachCount > 0 && browserSession.tabs.size > 0,
      activeOperationCount: browserSession.activeOperationCount,
      preserveOnHide: browserSession.preserveOnHide,
      hasVisibleTab: [...browserSession.tabs.values()].some((tab) => tab.visible),
      tabCount: browserSession.tabs.size,
      activeTabId: browserSession.activeTabId,
      agentTabId: browserSession.agentTabId,
      tabs: [...browserSession.tabs.values()].map((tab) => ({
        tabId: tab.tabId,
        openedByAgent: tab.openedByAgent,
        lastActivityAt: tab.lastActivityAt,
        url: tab.state.url,
        title: tab.state.title,
      })),
    };
  }

  function getTab(browserSession, tabId) {
    if (tabId) {
      const tab = browserSession.tabs.get(tabId);
      if (!tab) throw hostError("标签不存在或已被关闭。", "no-tab");
      return tab;
    }
    if (browserSession.agentTabId) {
      const tab = browserSession.tabs.get(browserSession.agentTabId);
      if (tab) return tab;
    }
    if (browserSession.activeTabId) {
      const tab = browserSession.tabs.get(browserSession.activeTabId);
      if (tab) return tab;
    }
    const first = browserSession.tabs.values().next().value;
    if (!first) throw hostError("受管浏览器没有可用标签。", "no-tab");
    return first;
  }

  function ensureDebugger(tab) {
    const debuggerApi = tab.view.webContents.debugger;
    if (debuggerApi.isAttached()) return;
    try {
      debuggerApi.attach("1.3");
    } catch {
      throw hostError("无法连接页面调试通道，请重新加载页面。", "cdp-timeout");
    }
    tab.debuggerAttached = true;
    // debugger 断开 = backendNodeId 全部无意义，ref 必须作废。
    debuggerApi.on("detach", () => {
      tab.debuggerAttached = false;
      tab.refs.clear();
      tab.generation += 1;
    });
    ensureTabSession(tab);
  }

  /** Electron debugger 的 sendCommand 在页面卡死时可能永不 settle —— 必须自己带超时。 */
  function withTimeout(command, method, timeoutMs, signal) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (callback) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
        callback();
      };
      const onAbort = () => settle(() => reject(hostError("浏览器操作已取消。", "cdp-timeout")));
      const timer = setTimeout(
        () => settle(() => reject(hostError(`页面未在 ${Math.ceil(timeoutMs / 1000)} 秒内响应 ${method}，请重新加载页面。`, "cdp-timeout"))),
        timeoutMs,
      );
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }
      Promise.resolve()
        .then(command)
        .then((value) => settle(() => resolve(value)))
        .catch((error) => settle(() => reject(error)));
    });
  }

  function cdp(tab, method, params, timeoutMs = CDP_COMMAND_TIMEOUT_MS, signal) {
    ensureDebugger(tab);
    return withTimeout(() => tab.view.webContents.debugger.sendCommand(method, params || {}), method, timeoutMs, signal);
  }

  function assertGeneration(tab, generation) {
    if (tab.generation !== generation) {
      throw hostError("元素引用已失效，请重新调用 browser_observe。", "stale-ref");
    }
  }

  // ── 操作 ────────────────────────────────────────────────────────────────

  /**
   * 本地预览给的是站内相对地址（`/api/browser/preview?path=…`），这里补上应用自己的
   * loopback origin —— 宿主仍然只导航 http(s)，不会因为「这是自家的」而放行 file://。
   */
  function resolveNavigationTarget(url) {
    const value = String(url ?? "").trim();
    if (value.startsWith("/")) {
      const origin = serverOrigin();
      if (!origin) throw hostError("桌面端没有可用的应用 origin，无法打开本地预览。", "navigate-failed");
      return assertHostNavigableUrl(`${origin}${value}`);
    }
    return assertHostNavigableUrl(value);
  }

  async function loadUrl(tab, url, signal) {
    const target = resolveNavigationTarget(url);
    // 换文档先作废，服务端也会同步推进世代；两边都做，才不会出现
    // 「服务端说失效、宿主还留着 backendNodeId」的窗口。
    tab.refs.clear();
    tab.generation += 1;
    await withTimeout(() => tab.view.webContents.loadURL(target), "Page.navigate", NAVIGATE_TIMEOUT_MS, signal);
    tab.state.url = target;
    tab.lastActivityAt = now();
    return target;
  }

  async function navigate(request, signal) {
    const browserSession = getSession(request.sessionId);
    const tab = getTab(browserSession, request.tabId);
    const url = request.payload && request.payload.url;
    const target = await loadUrl(tab, url, signal);
    if (request.tabId !== undefined) browserSession.agentTabId = tab.tabId;
    return { tabId: tab.tabId, url: target, title: tab.state.title, generation: tab.generation };
  }

  async function observe(request, signal) {
    const browserSession = getSession(request.sessionId);
    const tab = getTab(browserSession, request.tabId);
    const maxElements = Math.max(20, Math.min(400, Number((request.payload && request.payload.maxElements) || 240)));
    const depth = Number((request.payload && request.payload.axDepth) || DEFAULT_AX_DEPTH);
    const response = await cdp(tab, "Accessibility.getFullAXTree", { depth }, OBSERVE_TIMEOUT_MS, signal);
    const nodes = Array.isArray(response.nodes) ? response.nodes.slice(0, MAX_AX_NODES) : [];

    const candidates = [];
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const backendNodeId = typeof node.backendDOMNodeId === "number" ? node.backendDOMNodeId : 0;
      const role = textOf(node.role);
      const name = textOf(node.name);
      const editable = role === "textbox" || role === "searchbox" || axEditable(node);
      if (!backendNodeId || !role) continue;
      // 无名元素只有本身可交互时才值得给模型看，否则输出会被一堆分隔线撑爆。
      if (!name && !editable && !["button", "textbox", "link", "checkbox", "combobox"].includes(role)) continue;
      candidates.push({ backendNodeId, role, name: name.slice(0, 160), editable, interactive: editable || INTERACTIVE_AX_ROLES.has(role.toLowerCase()) });
    }

    // 可交互优先（与参考实现同款分配：约 2/3 的预算给可交互节点）。
    const interactiveLimit = Math.ceil(maxElements * (2 / 3));
    const interactive = candidates.filter((item) => item.interactive).slice(0, interactiveLimit);
    const context = candidates.filter((item) => !item.interactive).slice(0, Math.max(0, maxElements - interactive.length));
    const selected = [...interactive, ...context];

    // 服务端会以这次 observe 为准开启新世代；宿主这里也存一份同代的表。
    tab.refs.clear();
    tab.generation += 1;
    for (const item of selected) tab.refs.set(item.backendNodeId, tab.generation);

    tab.lastActivityAt = now();
    syncState(tab, browserSession);
    return {
      tabId: tab.tabId,
      url: tab.state.url,
      title: tab.state.title,
      generation: tab.generation,
      elements: selected.map((item) => ({
        backendNodeId: item.backendNodeId,
        role: item.role,
        name: item.name,
        editable: item.editable,
      })),
    };
  }

  /** 服务端算好中心点用 scrollIntoView + getBoxModel 重新读一次 —— 不复用旧坐标。 */
  async function centerForNode(tab, backendNodeId, generation, signal) {
    assertGeneration(tab, generation);
    await cdp(tab, "DOM.scrollIntoViewIfNeeded", { backendNodeId }, CDP_COMMAND_TIMEOUT_MS, signal);
    assertGeneration(tab, generation);
    const box = await cdp(tab, "DOM.getBoxModel", { backendNodeId }, CDP_COMMAND_TIMEOUT_MS, signal);
    assertGeneration(tab, generation);
    const quad = box && box.model && Array.isArray(box.model.content) ? box.model.content : [];
    if (quad.length < 8 || !quad.every((value) => typeof value === "number")) {
      throw hostError("目标元素当前不可点击，请重新观察页面。", "not-visible");
    }
    return {
      x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4,
      y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4,
    };
  }

  async function click(request, signal) {
    const browserSession = getSession(request.sessionId);
    const tab = getTab(browserSession, request.tabId);
    const backendNodeId = Number(request.payload && request.payload.backendNodeId);
    if (!backendNodeId) throw hostError("缺少 backendNodeId。", "stale-ref");
    const generation = tab.generation;
    if (tab.refs.get(backendNodeId) !== generation) {
      throw hostError("元素引用已失效，请重新调用 browser_observe。", "stale-ref");
    }
    const { x, y } = await centerForNode(tab, backendNodeId, generation, signal);
    await cdp(tab, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, CDP_COMMAND_TIMEOUT_MS, signal);
    await cdp(tab, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, CDP_COMMAND_TIMEOUT_MS, signal);
    assertGeneration(tab, generation);
    await cdp(tab, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, CDP_COMMAND_TIMEOUT_MS, signal);
    tab.lastActivityAt = now();
    syncState(tab, browserSession);
    return { tabId: tab.tabId, url: tab.state.url, title: tab.state.title, generation: tab.generation };
  }

  async function type(request, signal) {
    const browserSession = getSession(request.sessionId);
    const tab = getTab(browserSession, request.tabId);
    const backendNodeId = Number(request.payload && request.payload.backendNodeId);
    const text = String((request.payload && request.payload.text) ?? "");
    const pressEnter = request.payload && request.payload.pressEnter === true;
    if (!backendNodeId) throw hostError("缺少 backendNodeId。", "stale-ref");
    if (text.length > MAX_TEXT_INPUT_CHARS) throw hostError(`单次输入不能超过 ${MAX_TEXT_INPUT_CHARS} 个字符。`, "not-editable");
    const generation = tab.generation;
    if (tab.refs.get(backendNodeId) !== generation) {
      throw hostError("元素引用已失效，请重新调用 browser_observe。", "stale-ref");
    }

    // 先用 AX 树确认这个节点此刻**仍然可编辑**—— observe 之后页面可能换了控件。
    const partial = await cdp(tab, "Accessibility.getPartialAXTree", { backendNodeId, fetchRelatives: false }, CDP_COMMAND_TIMEOUT_MS, signal);
    const nodes = Array.isArray(partial.nodes) ? partial.nodes : [];
    const current = nodes.find((node) => node && typeof node === "object" && node.backendDOMNodeId === backendNodeId);
    if (!current) throw hostError("目标字段已消失，请重新观察页面。", "stale-ref");
    const role = textOf(current.role);
    if (!(role === "textbox" || role === "searchbox" || axEditable(current))) {
      throw hostError("目标元素不是可编辑字段。", "not-editable");
    }
    await centerForNode(tab, backendNodeId, generation, signal);
    await cdp(tab, "DOM.focus", { backendNodeId }, CDP_COMMAND_TIMEOUT_MS, signal);
    assertGeneration(tab, generation);
    // 聚焦要真的生效：AX 树里的 focused 属性是唯一的真相来源（页面可能把输入事件
    // 拦掉、或节点在 focus 之前就被换掉了）。
    const focused = await cdp(tab, "Accessibility.getPartialAXTree", { backendNodeId, fetchRelatives: false }, CDP_COMMAND_TIMEOUT_MS, signal);
    const focusedNodes = Array.isArray(focused.nodes) ? focused.nodes : [];
    const focusedSelf = focusedNodes.find((node) => node && typeof node === "object" && node.backendDOMNodeId === backendNodeId);
    if (!focusedSelf || !axBoolean(focusedSelf, "focused")) {
      throw hostError("无法聚焦目标字段，请重新观察页面后重试。", "not-visible");
    }
    if (text) await cdp(tab, "Input.insertText", { text }, CDP_COMMAND_TIMEOUT_MS, signal);
    if (pressEnter) {
      const key = NAVIGATION_KEY_CODES.Enter;
      // 导航键必须带 windowsVirtualKeyCode，否则 Chromium 不认、也不触发默认行为。
      await cdp(tab, "Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: key.code, windowsVirtualKeyCode: key.windowsVirtualKeyCode, nativeVirtualKeyCode: key.windowsVirtualKeyCode, text: key.text }, CDP_COMMAND_TIMEOUT_MS, signal);
      assertGeneration(tab, generation);
      await cdp(tab, "Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: key.code, windowsVirtualKeyCode: key.windowsVirtualKeyCode, nativeVirtualKeyCode: key.windowsVirtualKeyCode }, CDP_COMMAND_TIMEOUT_MS, signal);
    }
    tab.lastActivityAt = now();
    syncState(tab, browserSession);
    return { tabId: tab.tabId, url: tab.state.url, title: tab.state.title, generation: tab.generation, chars: text.length };
  }

  async function scroll(request, signal) {
    const browserSession = getSession(request.sessionId);
    const tab = getTab(browserSession, request.tabId);
    const payload = request.payload || {};
    const step = 600;
    let deltaY;
    let summary;
    if (payload.to === "top" || payload.to === "bottom") {
      // 首末屏用 Runtime.evaluate 拿真实高度再滚到绝对位置；这是固定表达式，
      // 不接受任何来自页面的输入（页面只是被读取）。
      const measured = await cdp(tab, "Runtime.evaluate", {
        expression: "(() => ({ max: Math.max(0, (document.scrollingElement || document.documentElement).scrollHeight - window.innerHeight), y: (document.scrollingElement || document.documentElement).scrollTop }))()",
        returnByValue: true,
      }, CDP_COMMAND_TIMEOUT_MS, signal);
      const value = measured && measured.result && measured.result.value ? measured.result.value : { max: 0, y: 0 };
      deltaY = payload.to === "top" ? -value.y : value.max - value.y;
      summary = `滚到${payload.to === "top" ? "页首" : "页尾"}`;
    } else if (typeof payload.deltaY === "number") {
      if (!Number.isFinite(payload.deltaY) || Math.abs(payload.deltaY) > MAX_SCROLL_DELTA) {
        throw hostError(`deltaY 必须是绝对值不超过 ${MAX_SCROLL_DELTA} 的有限数字。`, "host-error");
      }
      deltaY = payload.deltaY;
      summary = `滚动 ${deltaY}px`;
    } else {
      deltaY = payload.direction === "up" ? -step : step;
      summary = `滚动 ${payload.direction === "up" ? "上" : "下"}一屏`;
    }
    await cdp(tab, "Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: 1,
      y: 1,
      deltaX: 0,
      deltaY,
      canScroll: true,
    }, CDP_COMMAND_TIMEOUT_MS, signal);
    tab.lastActivityAt = now();
    syncState(tab, browserSession);
    return { tabId: tab.tabId, summary, moved: deltaY !== 0 };
  }

  /**
   * 抽正文。表达式由服务端（`lib/browser-page-scripts.ts` 的固定模板）生成后随请求送来；
   * 宿主**不接受任何 agent 直接提供的脚本** —— 协议里根本没有这样的字段。
   */
  async function extract(request, signal) {
    const browserSession = getSession(request.sessionId);
    const tab = getTab(browserSession, request.tabId);
    const expression = request.payload && request.payload.expression;
    if (typeof expression !== "string" || !expression || expression.length > 1_000_000) {
      throw hostError("缺少抽取表达式。", "host-error");
    }
    const response = await cdp(tab, "Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }, CDP_COMMAND_TIMEOUT_MS, signal);
    if (response && response.exceptionDetails) {
      throw hostError("页面内容抽取失败。", "host-error");
    }
    const value = response && response.result ? response.result.value : null;
    tab.lastActivityAt = now();
    syncState(tab, browserSession);
    return isPlainObject(value) ? value : { ok: true, text: String(value ?? ""), truncated: false, totalChars: 0 };
  }

  async function screenshot(request, signal) {
    const browserSession = getSession(request.sessionId);
    const tab = getTab(browserSession, request.tabId);
    const response = await cdp(tab, "Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, CDP_COMMAND_TIMEOUT_MS, signal);
    const data = response && typeof response.data === "string" ? response.data : "";
    if (!data) throw hostError("截图失败。", "host-error");
    // 体积上限在这里先判一次（最后一道），服务端还会再判一次。
    const bytes = Math.floor((data.replace(/[^A-Za-z0-9+/=]/g, "").length * 3) / 4);
    if (bytes > MAX_SCREENSHOT_BYTES) {
      throw hostError("截图过大，请缩小页面或改用 browser_observe。", "host-error");
    }
    tab.lastActivityAt = now();
    return { tabId: tab.tabId, mimeType: "image/png", data, bytes, url: tab.state.url, title: tab.state.title };
  }

  async function newTab(request, signal) {
    const browserSession = getSession(request.sessionId);
    const tab = createTabRecord(browserSession, { openedByAgent: true, partition: browserSession.partition });
    browserSession.tabs.set(tab.tabId, tab);
    browserSession.agentTabId = tab.tabId;
    browserSession.activeTabId = tab.tabId;
    // 服务端在调用前已按 planTabReclaim 规划过回收；这里再做一次硬上限兜底，
    // 宁可直接拒绝新标签，也不要悄悄关掉用户的页面。
    if (browserSession.tabs.size > MAX_TABS) {
      const reclaimable = [...browserSession.tabs.values()]
        .filter((candidate) => candidate.openedByAgent && candidate.tabId !== browserSession.activeTabId)
        .sort((left, right) => left.lastActivityAt - right.lastActivityAt);
      while (browserSession.tabs.size > MAX_TABS && reclaimable.length > 0) {
        const victim = reclaimable.shift();
        disposeTab(browserSession, victim);
      }
      if (browserSession.tabs.size > MAX_TABS) {
        throw hostError(`标签已达 ${MAX_TABS} 个上限，且没有可以安全回收的 Agent 标签。`, "host-error");
      }
    }
    attachSession(browserSession);
    const url = request.payload && request.payload.url;
    if (url) await loadUrl(tab, url, signal);
    emitState();
    return { tabId: tab.tabId, url: tab.state.url, title: tab.state.title, generation: tab.generation };
  }

  async function switchTab(request) {
    const browserSession = getSession(request.sessionId);
    const tab = getTab(browserSession, request.tabId);
    browserSession.agentTabId = tab.tabId;
    browserSession.activeTabId = tab.tabId;
    attachSession(browserSession);
    emitState();
    return { tabId: tab.tabId, url: tab.state.url, title: tab.state.title, generation: tab.generation };
  }

  async function closeTab(request) {
    const browserSession = getSession(request.sessionId);
    const tab = getTab(browserSession, request.tabId);
    const tabId = tab.tabId;
    const remaining = browserSession.tabs.size - 1;
    disposeTab(browserSession, tab);
    if (remaining <= 0) {
      sessions.delete(browserSession.sessionId);
      emitState();
      return { closed: true, tabId, sessionClosed: true };
    }
    // 用户在前台看的那一个优先作为下一个 active。
    browserSession.activeTabId = browserSession.tabs.has(browserSession.activeTabId)
      ? browserSession.activeTabId
      : browserSession.tabs.keys().next().value;
    attachSession(browserSession);
    emitState();
    return { closed: true, tabId, sessionClosed: false };
  }

  function stateSnapshot() {
    return {
      totalSessions: sessions.size,
      sessions: [...sessions.values()].map(sessionSummary),
    };
  }

  function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  const OPS = {
    state: () => stateSnapshot(),
    navigate,
    observe,
    click,
    type,
    scroll,
    extract,
    screenshot,
    newTab,
    switchTab,
    closeTab,
    closeSession: (request) => {
      const target = (request.payload && request.payload.sessionId) || request.sessionId;
      closeSession(target);
      return { closed: true, sessionId: target };
    },
  };

  /** 给 agent 操作计一次在途计数：这个 session 正在被操作时永不参与 LRU 回收。 */
  function withOperationLease(sessionId, task) {
    const browserSession = sessions.get(sessionId);
    if (!browserSession) return task();
    browserSession.activeOperationCount += 1;
    return Promise.resolve()
      .then(task)
      .finally(() => {
        browserSession.activeOperationCount = Math.max(0, browserSession.activeOperationCount - 1);
      });
  }

  async function start() {
    if (server) return server;
    server = await startBrowserHostServer(async (request, signal) => {
      const handler = OPS[request.op];
      if (!handler) throw hostError("不支持的操作。", "unknown-op");
      return withOperationLease(request.sessionId, () => handler(request, signal));
    }, {
      // 端口必须随机分配：固定端口会被本机其它进程占，也会被记住后复用。
      port: 0,
      ...(endpointPath ? { endpointPath } : {}),
    });
    return server;
  }

  function stop() {
    if (!server) return;
    server.close();
    server = null;
    for (const sessionId of [...sessions.keys()]) closeSession(sessionId);
  }

  return {
    start,
    stop,
    get endpoint() {
      return server ? server.endpoint : null;
    },
    /** 窗口重建（Windows 全屏切换、恢复崩溃）后重新挂载视图。 */
    attach() {
      attachCount += 1;
      for (const browserSession of sessions.values()) attachSession(browserSession);
      emitState();
    },
    /** 记录一次布局：Web 端 BrowserPanel 用 CSS 兜底，桌面端用真实 bounds 覆盖 iframe。 */
    layout(sessionId, bounds) {
      const browserSession = sessions.get(sessionId);
      if (!browserSession) return;
      const tab = browserSession.tabs.get(browserSession.activeTabId);
      if (!tab) return;
      tab.bounds = {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      };
      attachSession(browserSession);
    },
    /** 面板显示 / 隐藏：决定这个 session 算不算「前台」。 */
    setPresentation(sessionId, visible) {
      const browserSession = sessions.get(sessionId);
      if (!browserSession) return;
      // preserveOnHide：面板被应用浮层遮挡等情况下 UI 明确要求「留着」，
      // 这条让 LRU 回收跳过它（见 lib/browser-capacity.ts 的 isReclaimableBackgroundSession）。
      browserSession.preserveOnHide = !visible;
      for (const tab of browserSession.tabs.values()) {
        tab.visible = visible;
        if (!visible) detachTab(tab);
      }
      if (visible) attachSession(browserSession);
      emitState();
    },
    onStateChange(listener) {
      emitState = () => {
        try {
          listener(stateSnapshot());
        } catch {
          /* 监听方自己的问题不该打断浏览器 */
        }
      };
    },
    /** 本地预览：把已授权的文件变成站内相对地址（宿主补上 server origin）。 */
    resolvePreviewUrl(relativeUrl) {
      const origin = serverOrigin();
      if (!origin) throw hostError("桌面端没有可用的应用 origin。", "host-error");
      return `${origin}${relativeUrl}`;
    },
  };
}

module.exports = {
  createBrowserHost,
  persistentPartition,
  assertHostNavigableUrl,
  MAX_TABS,
};