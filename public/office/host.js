// fork:office-editor —— GenOffice DOCX 编辑器在本仓的宿主适配层。
//
// 上游产物（assets/index-*.js，Apache-2.0，来源见 ./provenance.json）只认识一个
// `window.desktop` 接口。这里把它接到本仓的文件 API：
//   打开  GET  /api/files/<path>?type=download              → ArrayBuffer
//   保存  POST /api/files/<dir>?type=upload&conflict=overwrite
//   冲突  GET  /api/files/<path>?type=meta                   → size + mtimeMs 快照
// 未实现的方法与上游插件桥接同一形状：`on*` 返回空的取消订阅，其余返回 {ok:false}。
//
// 父子通信（编辑页在 FileViewer 的 iframe 里）：
//   pi-office:check  → {dirty, autoSave, filePath}
//   pi-office:flush  → 让编辑器把未保存改动写回，回 {ok}

const params = new URLSearchParams(location.search);
const filePath = params.get("path") ?? "";
const sessionId = params.get("sessionId") ?? "";
const language = (params.get("lang") ?? "zh").toLowerCase().startsWith("zh") ? "zh" : "en";
const theme = params.get("theme") === "dark" ? "dark" : "light";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const statusEl = document.querySelector(".office-status");
let statusTimer = 0;
function showStatus(text, alert = false) {
  if (!statusEl) return;
  window.clearTimeout(statusTimer);
  statusEl.textContent = text;
  statusEl.setAttribute("role", alert ? "alert" : "status");
  statusEl.hidden = false;
  statusTimer = window.setTimeout(() => { statusEl.hidden = true; }, alert ? 8000 : 2500);
}

// ── 路径编解码（与 lib/file-paths.ts 的 encodeFilePathForApi 同规则）────────────

function toSlashes(p) {
  return p.replace(/\\/g, "/");
}

function fileName(p) {
  const normalized = toSlashes(p).replace(/\/+$/, "");
  return normalized.split("/").pop() || normalized;
}

function dirName(p) {
  const normalized = toSlashes(p).replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  if (index < 0) return "";
  if (index === 0) return "/";
  if (index === 2 && /^[a-zA-Z]:\//.test(normalized)) return normalized.slice(0, 3);
  return normalized.slice(0, index);
}

function encodePath(p) {
  const normalized = toSlashes(p);
  const segments = normalized.split("/").filter(Boolean);
  if (normalized.startsWith("//") && segments.length > 0) segments[0] = `//${segments[0]}`;
  return segments.map(encodeURIComponent).join("/");
}

function apiUrl(p, type) {
  const base = `/api/files/${encodePath(p)}?type=${type}`;
  return sessionId ? `${base}&sessionId=${encodeURIComponent(sessionId)}` : base;
}

// ── 打开 / 保存 ──────────────────────────────────────────────────────────────

let openedVersion = null;

async function readVersion() {
  try {
    const response = await fetch(apiUrl(filePath, "meta"));
    if (!response.ok) return null;
    const data = await response.json();
    return { size: data.size, mtimeMs: data.mtimeMs };
  } catch {
    return null;
  }
}

function sameVersion(a, b) {
  return Boolean(a) && Boolean(b) && a.size === b.size && a.mtimeMs === b.mtimeMs;
}

async function loadFile() {
  const response = await fetch(apiUrl(filePath, "download"));
  if (!response.ok) throw new Error(`无法读取文件（HTTP ${response.status}）`);
  const data = await response.arrayBuffer();
  openedVersion = await readVersion();
  return { path: filePath, name: fileName(filePath), data };
}

async function saveDocx(_path, data) {
  if (!filePath) return { ok: false, error: "没有打开的文件" };
  const current = await readVersion();
  // 打开后文件被别的程序改过就拒绝覆盖；编辑器会保留未保存状态并提示。
  if (openedVersion && current && !sameVersion(current, openedVersion)) {
    return { ok: false, reason: "external-modified", error: "文件已被其他程序修改，未覆盖" };
  }
  const form = new FormData();
  form.append("files", new File([data], fileName(filePath), { type: DOCX_MIME }));
  const response = await fetch(`/api/files/${encodePath(dirName(filePath))}?type=upload&conflict=overwrite`, {
    method: "POST",
    body: form,
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // 非 JSON 错误体：下面按 HTTP 状态报。
  }
  if (!response.ok || (Array.isArray(payload.errors) && payload.errors.length > 0)) {
    const detail = payload.error || payload.errors?.[0]?.error || `HTTP ${response.status}`;
    return { ok: false, error: `保存失败：${detail}` };
  }
  openedVersion = await readVersion();
  return { ok: true, path: filePath };
}

function downloadCopy(name, data) {
  const url = URL.createObjectURL(new Blob([data], { type: DOCX_MIME }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = /\.docx$/i.test(name) ? name : `${name}.docx`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { ok: true, path: filePath };
}

// ── 关页检查：宿主（FileViewer）问「有未保存改动吗 / 先存一下」────────────────

const noop = () => {};
const unsubscribe = () => noop;
let openHandler = null;
let closeCheck = null;
let closeSave = null;
let checkWaiter = null;
let saveWaiter = null;

function invokeCheck() {
  return new Promise((resolve) => {
    if (!closeCheck) {
      resolve(null);
      return;
    }
    const timer = window.setTimeout(() => finish(null), 2000);
    function finish(value) {
      window.clearTimeout(timer);
      if (checkWaiter === finish) checkWaiter = null;
      resolve(value);
    }
    checkWaiter = finish;
    closeCheck();
  });
}

function invokeSave() {
  return new Promise((resolve) => {
    if (!closeSave) {
      resolve(false);
      return;
    }
    const timer = window.setTimeout(() => finish(false), 60000);
    function finish(ok) {
      window.clearTimeout(timer);
      if (saveWaiter === finish) saveWaiter = null;
      resolve(ok === true);
    }
    saveWaiter = finish;
    closeSave();
  });
}

// ── window.desktop ───────────────────────────────────────────────────────────

let pendingPromise = null;

const desktop = new Proxy({
  getLanguage: async () => language,
  getTheme: async () => theme,
  onLanguageChanged: unsubscribe,
  onThemeChanged: unsubscribe,
  getAiPanelPrefs: async () => ({}),
  setAiPanelPrefs: async (patch) => patch,
  onAiPanelPrefsChanged: unsubscribe,
  getAutoSaveDefault: async () => ({ on: true, updatedAt: 0 }),
  onAutoSaveDefaultChanged: unsubscribe,
  getCurrentDocxPath: () => filePath,
  consumePendingOpenDocx: () => pendingPromise,
  consumeNewBlankDoc: async () => false,
  consumeAiDocContent: async () => null,
  consumeHeadlessExport: async () => null,
  openDocx: async () => null,
  openDocxPath: async (p) => (p === filePath ? pendingPromise : null),
  openDocxDecrypt: async () => ({ ok: false }),
  onOpenDocx: (listener) => {
    openHandler = listener;
    return () => {
      if (openHandler === listener) openHandler = null;
    };
  },
  onRenamedDocx: unsubscribe,
  saveDocx,
  saveDocxAs: (name, data) => downloadCopy(name, data),
  saveDocxNew: (name, data) => downloadCopy(name, data),
  saveDocxTo: async () => ({ ok: false }),
  writeRecoveryCopy: async () => {},
  createDocument: async () => ({ ok: false }),
  convertAltChunkHtml: async () => null,
  setDocPassword: async () => ({ ok: false }),
  docPasswordIntentRevision: async () => 0,
  discardDocPasswordIntents: async () => ({ ok: true }),
  getRecentFiles: async () => [],
  pickImage: async () => null,
  getPathForFile: () => null,
  getAiSettings: async () => ({ provider: "disabled", providers: {} }),
  setAiSettings: async () => ({ ok: false }),
  copyImageToClipboard: async () => false,
  print: () => window.print(),
  exportHtml: async () => ({ ok: false }),
  reportViewMenuState: noop,
  onTeardown: noop,
  respellKick: async () => {},
  spellDiag: noop,
  onCloseCheck: (listener) => {
    closeCheck = listener;
    return () => {
      if (closeCheck === listener) closeCheck = null;
    };
  },
  reportCloseCheck: (value) => checkWaiter?.(value),
  onCloseSaveRequest: (listener) => {
    closeSave = listener;
    return () => {
      if (closeSave === listener) closeSave = null;
    };
  },
  reportCloseSaveResult: (value) => saveWaiter?.(value === true),
}, {
  get(target, property) {
    if (property in target) return target[property];
    if (String(property).startsWith("on")) return unsubscribe;
    return async () => ({ ok: false });
  },
});

window.desktop = desktop;
window.filesPaneApi = new Proxy({}, { get: () => async () => ({ ok: false, entries: [] }) });
window.projectApi = new Proxy({}, { get: () => async () => null });

window.addEventListener("message", async (event) => {
  if (event.source !== window.parent) return;
  const message = event.data;
  if (!message || typeof message !== "object") return;
  if (message.type === "pi-office:check") {
    const value = await invokeCheck();
    window.parent.postMessage({ type: "pi-office:check-result", id: message.id, value }, location.origin);
  } else if (message.type === "pi-office:flush") {
    const ok = await invokeSave();
    window.parent.postMessage({ type: "pi-office:flush-result", id: message.id, ok }, location.origin);
  }
});

// ── 启动 ─────────────────────────────────────────────────────────────────────

async function boot() {
  if (!filePath) {
    showStatus("缺少文件路径", true);
    return;
  }
  pendingPromise = loadFile().catch((error) => {
    showStatus(error?.message || String(error), true);
    return null;
  });
  try {
    const editor = await import("./assets/index-CiXp5RFk.js");
    await editor.ready;
  } catch (error) {
    showStatus(error?.message || String(error), true);
  }
}

boot();
