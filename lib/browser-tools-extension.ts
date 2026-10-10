/**
 * fork:proma-42-browser · 受管浏览器的 10 个原子工具（pi 内联扩展）。
 *
 * 形态遵循 `AGENTS.md`「产品能力不许降级成 skill」：这是**工具**，不是 skill。工具名进
 * `get_tools` 清单、可被 `lib/approval-policy.ts` 拦、可统计、有 UI。
 *
 * 四条不变量（每一条都对应参考实现里一个真踩过的坑）：
 *
 * 1. **原子优先于 executeJavaScript**。10 个工具里没有一个接受 agent 写的 JS。
 *    唯一必须在页面上下文跑的事（`browser_extract` 抽正文）由
 *    `lib/browser-page-scripts.ts` 用**固定模板 + JSON 序列化参数**生成表达式，宿主只负责
 *    把成品送进页面。页面自己提供或诱导的脚本一律不执行。
 *
 * 2. **AX ref 世代管理**。`browser_observe` 开的每一代 ref，只有同一代能用：
 *    每次 observe / navigate / new_tab 都会让该标签上一代 ref 全部失效
 *    （`lib/browser-ref-store.ts`）。agent 拿着上一代的 ref 点过来，得到的是
 *    「请重新调用 browser_observe」，而不是点了另一个按钮。
 *
 * 3. **容量有上限**。标签 20 个、后台会话 8 个（LRU，只回收 Agent 自己开的、且不在前台、
 *    且没有进行中操作的）、截图 3MB、脚本结果 64000 字符。宁可暂时超额，也绝不自动
 *    关闭用户自己打开的页面。
 *
 * 4. **风险告知门**。首次调用前问一次（站点可能识别为自动化 → 验证码 / 限流 / 风控），
 *    用户确认后才继续；明确拒绝之后不再重复弹窗。
 *
 * URL 策略、世代、容量、风险门四块纯逻辑都在各自模块里并带 `.test.mjs`；本文件只做
 * 「把模型的参数翻译成宿主 op，再把宿主结果翻译成模型看得懂的东西」。
 */

import { Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionToolContext,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";
import {
  BROWSER_OBSERVE_TIMEOUT_MS,
  MAX_BROWSER_TEXT_INPUT_CHARS,
  assertScreenshotWithinLimit,
  clampBrowserScriptResult,
  clampObserveElements,
  planBackgroundSessionEviction,
  planTabReclaim,
  resolveObserveAxDepth,
} from "./browser-capacity";
import { BrowserHostUnavailableError } from "./browser-endpoint";
import { callBrowserHost, BrowserHostCallError } from "./browser-host-client";
import type { BrowserHostOp } from "./browser-host-protocol";
import { assertBrowserSelector, buildBrowserExtractExpression } from "./browser-page-scripts";
import { BrowserRefStaleError, getBrowserRefRegistry, type BrowserObservedElement } from "./browser-ref-store";
import {
  BROWSER_RISK_NOTICE_KEYS,
  BrowserRiskGate,
  createBrowserRiskRecord,
  serializeBrowserRiskRecord,
} from "./browser-risk-gate";
import { assertNavigableBrowserUrl, BrowserUrlRejected } from "./browser-url-policy";

export const HOST_BROWSER_EXTENSION_NAME = "pi-web-browser";

/** 风险确认写进会话文件的 custom entry 类型（与 approval grants 同一套语义）。 */
export const BROWSER_RISK_ENTRY_TYPE = "pi-web:browser-risk-ack";

/**
 * 10 个原子工具。名字与参考实现一致（`BrowserNavigate` → `browser_navigate`），
 * 这样照着 Proma 的用法写提示词的人不用改口。
 */
export const BROWSER_TOOL_NAMES = [
  "browser_navigate",
  "browser_observe",
  "browser_click",
  "browser_type",
  "browser_scroll",
  "browser_extract",
  "browser_screenshot",
  "browser_new_tab",
  "browser_switch_tab",
  "browser_close",
] as const;

export type BrowserToolName = (typeof BROWSER_TOOL_NAMES)[number];

/** 宿主不可用时统一给模型的一句话（Web 部署就是这条路）。 */
export const BROWSER_UNAVAILABLE_HINT =
  "受管浏览器只在 Pi Web 桌面端可用；请让用户改用桌面端，或用其它手段拿信息。";

/** 可读风险状态（诊断 / 测试用）。 */
export type BrowserRiskStateView = "unacknowledged" | "acknowledged" | "denied";

export interface BrowserRiskText {
  title: string;
  body: string;
  accept: string;
  deny: string;
}

export interface BrowserToolDeps {
  /** 宿主传输；测试注入假实现，生产走 loopback（`lib/browser-host-client.ts`）。 */
  callHost?: typeof callBrowserHost;
  /** 本地预览用的授权根；默认 `getAllowedFileRoots()`。 */
  allowedRoots?: () => Promise<Set<string>>;
  /** 会话 id；默认 `ctx.sessionManager.getSessionId()`。 */
  sessionId?: (ctx: ExtensionToolContext) => string;
  /** 会话 cwd；默认 `ctx.cwd`。 */
  cwd?: (ctx: ExtensionToolContext) => string;
  /** 端点文件路径（测试用）。 */
  endpointPath?: string;
  /** 风险提示文案；默认走 i18n key，测试注入短串。 */
  riskText?: BrowserRiskText;
}

interface HostInit {
  tabId?: string;
  payload?: Record<string, unknown>;
  timeoutMs?: number;
  /** 容量规划这类内部查询不该弹风险确认——风险门属于「真正要动浏览器」的动作。 */
  skipRisk?: boolean;
}

interface ObserveResult {
  tabId: string;
  url: string;
  title: string;
  elements: Array<{ backendNodeId: number; role: string; name: string; editable: boolean }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: unknown, key: string): string | undefined {
  if (!isRecord(source)) return undefined;
  const value = source[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(source: unknown, key: string): number | undefined {
  if (!isRecord(source)) return undefined;
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sessionsOf(state: unknown): Array<Record<string, unknown>> {
  return isRecord(state) && Array.isArray(state.sessions) ? state.sessions.filter(isRecord) : [];
}

/** 观察结果 → 交给模型的紧凑行。ref 是模型唯一的抓手，所以必须一眼可见。 */
export function formatObserveLines(
  elements: readonly { ref: string; role: string; name: string; editable: boolean }[],
): string {
  return elements
    .map((element) => `${element.ref} ${element.role}${element.name ? ` 「${element.name}」` : ""}${element.editable ? " [可输入]" : ""}`)
    .join("\n");
}

/** 从分支里的 custom entry 读回风险确认；读不到 = 没确认过。 */
export function readBrowserRiskFromBranch(entries: readonly unknown[]): unknown {
  let restored: unknown = null;
  for (const entry of entries) {
    if (!isRecord(entry) || entry.type !== "custom") continue;
    if (entry.customType !== BROWSER_RISK_ENTRY_TYPE) continue;
    restored = entry.data;
  }
  return restored;
}

/**
 * 本地预览解析。默认走 `getAllowedFileRoots()` + 会话 cwd。
 *
 * 这里用**动态 import** 而不是顶层 import：`lib/file-access.ts` 会拉整个会话列表，
 * 而单测只想断言这个扩展的形状，不该被那一串依赖拖进 I/O。
 */
async function resolveLocalPreview(
  ctx: ExtensionToolContext,
  localPath: string,
  deps: BrowserToolDeps,
): Promise<{ url: string; fileName: string }> {
  const [fileAccess, preview, fs, nodePath] = await Promise.all([
    import("./file-access"),
    import("./browser-local-preview"),
    import("node:fs"),
    import("node:path"),
  ]);
  const roots = deps.allowedRoots ? await deps.allowedRoots() : await fileAccess.getAllowedFileRoots();
  const baseDir = (deps.cwd ?? ((context) => context.cwd))(ctx);
  return preview.resolveBrowserLocalPreview(localPath, {
    roots,
    baseDir,
    resolvePath: (base, target) => nodePath.resolve(base, target),
    realPath: (target) => {
      try {
        return fs.realpathSync(target);
      } catch {
        return target;
      }
    },
    exists: (target) => fs.existsSync(target),
    isDirectory: (target) => fs.statSync(target).isDirectory(),
    isFile: (target) => fs.statSync(target).isFile(),
  });
}

export function createBrowserToolsExtension(deps: BrowserToolDeps = {}): InlineExtension {
  const callHost = deps.callHost ?? callBrowserHost;
  const registry = getBrowserRefRegistry();

  return {
    name: HOST_BROWSER_EXTENSION_NAME,
    hidden: true,
    factory: (pi: ExtensionAPI) => {
      const gate = new BrowserRiskGate(createBrowserRiskRecord());

      // 事件回调拿到的是 ExtensionContext（没有 tools/executeTool）；这里只读 sessionManager。
      const restore = (ctx: ExtensionContext): void => {
        // 从没写过记录 = 没确认过；绝不因为「找不到记录」就当成已确认。
        gate.restore(readBrowserRiskFromBranch(ctx.sessionManager.getBranch()));
      };
      pi.on("session_start", async (_event, ctx) => restore(ctx));
      pi.on("session_tree", async (_event, ctx) => restore(ctx));

      /** 风险告知门：非 allow 一律停下，且不重复打扰已拒绝的用户。 */
      const ensureRiskAllowed = async (ctx: ExtensionToolContext): Promise<void> => {
        const verdict = gate.evaluate();
        if (verdict === "allow") return;
        if (verdict === "denied") {
          throw new Error("用户已拒绝受管浏览器的风险提示，本次不再调用浏览器工具。");
        }
        if (!ctx.hasUI) {
          throw new Error(`受管浏览器需要用户先确认一次风险提示（${BROWSER_RISK_NOTICE_KEYS.title}），而当前没有可用的交互界面。`);
        }
        const text = deps.riskText ?? {
          title: BROWSER_RISK_NOTICE_KEYS.title,
          body: BROWSER_RISK_NOTICE_KEYS.body,
          accept: BROWSER_RISK_NOTICE_KEYS.accept,
          deny: BROWSER_RISK_NOTICE_KEYS.deny,
        };
        let accepted = false;
        try {
          /* fork:ext-i18n-keys（2026-10-08）—— 只发 title + body 两个 key，不再拼
             `[accept] / [deny]`：对话框底部本来就有「取消 / 确认」两枚按钮，再拼一行
             `[我知道了，继续] / [不开启]` 是把同一件事说两遍，而且那串括号在渲染端
             翻不出来（用户实拍就是一行 `[browser.riskGate.accept] / [browser.riskGate.deny]`）。
             `accept` / `deny` 仍留在类型里，供将来需要自定义按钮文案的宿主使用。 */
          accepted = await ctx.ui.confirm(text.title, text.body);
        } catch {
          // 对话框被取消 / 用户点了停止：一律当拒绝。
          accepted = false;
        }
        if (!accepted) {
          gate.deny();
          throw new Error("用户拒绝了受管浏览器的风险提示，本次不再调用浏览器工具。");
        }
        gate.acknowledge();
        try {
          pi.appendEntry(BROWSER_RISK_ENTRY_TYPE, serializeBrowserRiskRecord(gate.snapshot()));
        } catch (error) {
          // 写不进去只影响「下次还要再问一次」，本次放行不受影响。
          console.error("[pi-web] failed to persist browser risk acknowledgement:", error instanceof Error ? error.message : error);
        }
      };

      const host = async (ctx: ExtensionToolContext, op: BrowserHostOp, init: HostInit): Promise<unknown> => {
        const sessionId = (deps.sessionId ?? ((context) => context.sessionManager.getSessionId()))(ctx);
        if (!init.skipRisk) await ensureRiskAllowed(ctx);
        return callHost(op, {
          sessionId,
          ...(init.tabId ? { tabId: init.tabId } : {}),
          ...(init.payload ? { payload: init.payload } : {}),
          ...(init.timeoutMs ? { timeoutMs: init.timeoutMs } : {}),
          ...(deps.endpointPath ? { endpointPath: deps.endpointPath } : {}),
          signal: ctx.signal,
        });
      };

      /** 失败 → 一句能直接展示的话，不把 stack 丢给模型。 */
      const describeFailure = (error: unknown): never => {
        if (error instanceof BrowserHostUnavailableError) {
          throw new Error(`${error.message}\n${BROWSER_UNAVAILABLE_HINT}`);
        }
        if (error instanceof BrowserUrlRejected) throw error;
        if (error instanceof BrowserRefStaleError) throw error;
        if (error instanceof BrowserHostCallError) {
          throw new Error(`浏览器操作失败（${error.code}）：${error.message}`);
        }
        throw error instanceof Error ? error : new Error(String(error));
      };

      /** 后台会话 LRU。宿主只报状态，关谁在这里决定。 */
      const evictBackgroundSessions = async (ctx: ExtensionToolContext, state: unknown): Promise<void> => {
        const candidates = sessionsOf(state).map((summary) => ({
          sessionId: String(summary.sessionId ?? ""),
          lastActivityAt: readNumber(summary, "lastActivityAt") ?? 0,
          hasPresentation: summary.hasPresentation === true,
          activeOperationCount: readNumber(summary, "activeOperationCount") ?? 0,
          preserveOnHide: summary.preserveOnHide === true,
          hasVisibleTab: summary.hasVisibleTab === true,
        })).filter((entry) => entry.sessionId);
        for (const sessionId of planBackgroundSessionEviction(candidates)) {
          try {
            await host(ctx, "closeSession", { payload: { sessionId }, skipRisk: true });
          } catch {
            /* 回收失败不升级成错误：下一轮再试，绝不因为回收打断用户正在做的事。 */
          }
        }
      };

      /** 标签容量：只回收 Agent 自己开的、且不是前台/工作标签的那些。 */
      const reclaimTabs = async (ctx: ExtensionToolContext, state: unknown): Promise<number> => {
        let reclaimed = 0;
        for (const summary of sessionsOf(state)) {
          const tabs = Array.isArray(summary.tabs) ? summary.tabs.filter(isRecord) : [];
          const candidates = tabs.map((tab) => ({
            tabId: String(tab.tabId ?? ""),
            openedByAgent: tab.openedByAgent === true,
            isActiveTab: String(tab.tabId ?? "") === String(summary.activeTabId ?? ""),
            isAgentTab: String(tab.tabId ?? "") === String(summary.agentTabId ?? ""),
            lastActivityAt: readNumber(tab, "lastActivityAt") ?? 0,
          })).filter((tab) => tab.tabId);
          for (const tabId of planTabReclaim(candidates)) {
            try {
              await host(ctx, "closeTab", { tabId, payload: { reclaimed: true }, skipRisk: true });
              reclaimed += 1;
            } catch {
              /* 同上：关不掉就不关。 */
            }
          }
        }
        return reclaimed;
      };

      /** 每次动标签前跑一次容量规划。宿主不在线时静默跳过（反正没什么可回收）。 */
      const enforceCapacity = async (ctx: ExtensionToolContext): Promise<void> => {
        try {
          const state = await host(ctx, "state", { skipRisk: true });
          await evictBackgroundSessions(ctx, state);
          await reclaimTabs(ctx, state);
        } catch {
          /* best effort */
        }
      };

      /** ref 所属的 tabId：显式给了就用它，否则在所有已知标签里反查。 */
      const resolveEntry = (ref: string, tabId: string | undefined): { tabId: string; editable: boolean } => {
        if (tabId) {
          return { tabId, editable: registry.resolve(tabId, ref).editable };
        }
        const owners = Object.keys(registry.stats().generations).filter((candidate) => {
          try {
            registry.resolve(candidate, ref);
            return true;
          } catch {
            return false;
          }
        });
        if (owners.length === 1) return { tabId: owners[0], editable: registry.resolve(owners[0], ref).editable };
        if (owners.length > 1) {
          throw new Error(`ref ${ref} 在多个标签上都存在，请显式给出 tabId。`);
        }
        throw new BrowserRefStaleError("(未知标签)", ref, null, 0);
      };

      const tabSummary = (result: unknown): { tabId: string; url: string; title: string } => {
        const record = isRecord(result) ? result : {};
        return {
          tabId: String(record.tabId ?? ""),
          url: String(record.url ?? ""),
          title: String(record.title ?? ""),
        };
      };

      const browserTabParam = Type.Optional(Type.String({
        description: "目标标签 id。缺省用当前工作标签；工作标签已关闭时必须显式指定。",
      }));

      pi.registerTool(defineTool({
        name: "browser_navigate",
        label: "Browser navigate",
        description: [
          "在受管浏览器里打开一个地址（http/https 的公网、loopback 或私网站点）。",
          "禁止 file://；要看本地 HTML 请用 localPath，它只接受会话已授权目录内的文件。",
          "导航会使该标签上所有元素引用（ref）立即失效，之后必须重新 browser_observe。",
        ].join("\n"),
        promptSnippet: "Open a page in the managed in-app browser (desktop build only)",
        promptGuidelines: [
          "After browser_navigate, always browser_observe again — every ref from before the navigation is dead.",
          "There is deliberately no execute-JavaScript tool here; use the atomic tools instead.",
        ],
        executionMode: "sequential",
        parameters: Type.Object({
          url: Type.Optional(Type.String({ description: "要打开的 http/https 地址" })),
          localPath: Type.Optional(Type.String({ description: "会话已授权目录内的 .html/.htm 文件（代替 url）" })),
          tabId: browserTabParam,
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          try {
            if (params.url && params.localPath) throw new Error("url 与 localPath 只能给其中一个。");
            let target: string;
            let label: string;
            if (params.localPath) {
              const preview = await resolveLocalPreview(ctx, params.localPath, deps);
              target = preview.url;
              label = preview.fileName;
            } else if (params.url) {
              target = assertNavigableBrowserUrl(params.url).url;
              label = target;
            } else {
              throw new Error("browser_navigate 需要 url 或 localPath。");
            }
            await enforceCapacity(ctx);
            const result = await host(ctx, "navigate", {
              ...(params.tabId ? { tabId: params.tabId } : {}),
              payload: { url: target },
              timeoutMs: BROWSER_OBSERVE_TIMEOUT_MS + 3_000,
            });
            const tab = tabSummary(result);
            // 导航 = 换了一整个文档：这一代 ref 全部作废。
            if (tab.tabId) registry.invalidate(tab.tabId, "navigate");
            return {
              content: [{ type: "text" as const, text: `已打开 ${label}\n${tab.url || target}` }],
              details: { url: tab.url || target, tabId: tab.tabId },
            };
          } catch (error) {
            return describeFailure(error);
          }
        },
      }));

      pi.registerTool(defineTool({
        name: "browser_observe",
        label: "Browser observe",
        description: [
          "读取当前页面的可交互元素，返回带 ref 的清单。这是点击/输入的唯一凭据来源。",
          "每次调用都会开启新的一代 ref：上一次 observe 拿到的 ref 全部失效。",
        ].join("\n"),
        promptSnippet: "List the clickable / typeable elements of the current page as refs",
        promptGuidelines: [
          "Refs are single-generation. If a click or type failed with a stale-ref error, observe again instead of guessing a ref.",
          "Prefer a role+name you saw in the observe output; CSS selectors are for browser_extract.",
        ],
        executionMode: "sequential",
        parameters: Type.Object({
          tabId: browserTabParam,
          maxElements: Type.Optional(Type.Number({ description: "20–400，默认 240" })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          try {
            const maxElements = clampObserveElements(params.maxElements);
            const result = await host(ctx, "observe", {
              ...(params.tabId ? { tabId: params.tabId } : {}),
              payload: { maxElements, axDepth: resolveObserveAxDepth(maxElements) },
              timeoutMs: BROWSER_OBSERVE_TIMEOUT_MS + 3_000,
            });
            const observation = result as ObserveResult;
            if (!observation || !Array.isArray(observation.elements)) {
              throw new Error("浏览器没有返回可用的元素列表。");
            }
            const elements: BrowserObservedElement[] = observation.elements.map((element) => ({
              backendNodeId: Number(element?.backendNodeId ?? 0),
              role: String(element?.role ?? ""),
              name: String(element?.name ?? ""),
              editable: element?.editable === true,
            })).filter((element) => element.backendNodeId > 0 && element.role);
            const published = registry.publish(observation.tabId, elements);
            const header = `${observation.url || ""} — 第 ${published.generation} 代，共 ${published.refs.length} 个元素：`;
            return {
              content: [{
                type: "text" as const,
                text: published.refs.length
                  ? `${header}\n${formatObserveLines(published.refs)}`
                  : `${header}\n（没有可交互元素）`,
              }],
              details: { tabId: published.tabId, generation: published.generation, count: published.refs.length },
            };
          } catch (error) {
            return describeFailure(error);
          }
        },
      }));

      pi.registerTool(defineTool({
        name: "browser_click",
        label: "Browser click",
        description: "点击当前一代里某个 ref 指向的元素（派发真实鼠标事件，不是 element.click()）。",
        executionMode: "sequential",
        parameters: Type.Object({
          ref: Type.String({ description: "browser_observe 返回的 ref，例如 r3-17" }),
          tabId: browserTabParam,
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          try {
            const entry = resolveEntry(params.ref, params.tabId);
            const result = await host(ctx, "click", {
              tabId: entry.tabId,
              payload: { backendNodeId: registry.resolve(entry.tabId, params.ref).backendNodeId },
            });
            const tab = tabSummary(result);
            return {
              content: [{ type: "text" as const, text: `已点击 ${params.ref}${tab.url ? `\n页面：${tab.url}` : ""}` }],
              details: { ref: params.ref, tabId: entry.tabId },
            };
          } catch (error) {
            return describeFailure(error);
          }
        },
      }));

      pi.registerTool(defineTool({
        name: "browser_type",
        label: "Browser type",
        description: `往当前一代里某个可输入 ref 里写入文本（单次不超过 ${MAX_BROWSER_TEXT_INPUT_CHARS} 字符）。`,
        executionMode: "sequential",
        parameters: Type.Object({
          ref: Type.String({ description: "browser_observe 返回的 ref，且该元素标了 [可输入]" }),
          text: Type.String({ description: "要输入的文本" }),
          pressEnter: Type.Optional(Type.Boolean({ description: "输入后是否回车提交" })),
          tabId: browserTabParam,
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          try {
            if (params.text.length > MAX_BROWSER_TEXT_INPUT_CHARS) {
              throw new Error(`单次输入不能超过 ${MAX_BROWSER_TEXT_INPUT_CHARS} 个字符。`);
            }
            const entry = resolveEntry(params.ref, params.tabId);
            if (!entry.editable) {
              throw new Error(`ref ${params.ref} 不是可输入字段，请重新 browser_observe 后选标了 [可输入] 的元素。`);
            }
            await host(ctx, "type", {
              tabId: entry.tabId,
              payload: {
                backendNodeId: registry.resolve(entry.tabId, params.ref).backendNodeId,
                text: params.text,
                pressEnter: params.pressEnter === true,
              },
            });
            return {
              content: [{
                type: "text" as const,
                text: `已输入 ${params.text.length} 个字符到 ${params.ref}${params.pressEnter ? " 并回车" : ""}`,
              }],
              details: { ref: params.ref, chars: params.text.length, tabId: entry.tabId },
            };
          } catch (error) {
            return describeFailure(error);
          }
        },
      }));

      pi.registerTool(defineTool({
        name: "browser_scroll",
        label: "Browser scroll",
        description: "滚动页面（滚轮输入，不是 scrollTo）。",
        executionMode: "sequential",
        parameters: Type.Object({
          tabId: browserTabParam,
          direction: Type.Optional(Type.Union([Type.Literal("up"), Type.Literal("down")], { description: "方向；与 deltaY 二选一" })),
          deltaY: Type.Optional(Type.Number({ description: "像素位移，正数向下；绝对值不超过 50000" })),
          to: Type.Optional(Type.Union([Type.Literal("top"), Type.Literal("bottom")], { description: "滚到页首/页尾" })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          try {
            const payload: Record<string, unknown> = {};
            if (params.to) payload.to = params.to;
            else if (typeof params.deltaY === "number") payload.deltaY = params.deltaY;
            else payload.direction = params.direction ?? "down";
            const result = await host(ctx, "scroll", {
              ...(params.tabId ? { tabId: params.tabId } : {}),
              payload,
            });
            return {
              content: [{ type: "text" as const, text: readString(result, "summary") ?? "已滚动页面。" }],
              details: { ...payload, result: isRecord(result) ? result : null },
            };
          } catch (error) {
            return describeFailure(error);
          }
        },
      }));

      pi.registerTool(defineTool({
        name: "browser_extract",
        label: "Browser extract",
        description: "抽取页面正文（可选 CSS selector 限定范围），text 或 markdown。",
        executionMode: "sequential",
        parameters: Type.Object({
          tabId: browserTabParam,
          selector: Type.Optional(Type.String({ description: "CSS selector；缺省取整个 body" })),
          format: Type.Optional(Type.Union([Type.Literal("text"), Type.Literal("markdown")], { description: "默认 markdown" })),
          maxChars: Type.Optional(Type.Number({ description: "1–50000" })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          try {
            assertBrowserSelector(params.selector);
            // 表达式由本仓的固定模板生成：selector / maxChars 只作为 JSON 字面量注入。
            const expression = buildBrowserExtractExpression({
              ...(params.selector ? { selector: params.selector } : {}),
              format: params.format ?? "markdown",
              ...(params.maxChars ? { maxChars: params.maxChars } : {}),
            });
            const result = await host(ctx, "extract", {
              ...(params.tabId ? { tabId: params.tabId } : {}),
              payload: { expression },
            });
            const record = isRecord(result) ? result : {};
            const text = typeof record.text === "string" ? record.text : "";
            const clamped = clampBrowserScriptResult(text);
            return {
              content: [{ type: "text" as const, text: String(clamped.value) || "(空)" }],
              details: {
                truncated: record.truncated === true || clamped.truncated,
                totalChars: readNumber(record, "totalChars") ?? 0,
              },
            };
          } catch (error) {
            return describeFailure(error);
          }
        },
      }));

      pi.registerTool(defineTool({
        name: "browser_screenshot",
        label: "Browser screenshot",
        description: "截当前页面（PNG，上限 3MB）。结构优先用 browser_observe，正文优先用 browser_extract。",
        executionMode: "sequential",
        parameters: Type.Object({
          tabId: browserTabParam,
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          try {
            const result = await host(ctx, "screenshot", {
              ...(params.tabId ? { tabId: params.tabId } : {}),
              payload: {},
            });
            const base64 = readString(result, "data");
            if (!base64) throw new Error("浏览器没有返回截图数据。");
            // 体积在这里再卡一次：宿主那边的判断是最后一道，不是唯一一道。
            const screenshot = assertScreenshotWithinLimit(base64);
            return {
              content: [
                { type: "text" as const, text: `当前页面截图（${screenshot.mimeType}，${screenshot.bytes} 字节）` },
                { type: "image" as const, data: screenshot.data, mimeType: screenshot.mimeType },
              ],
              details: { bytes: screenshot.bytes },
            };
          } catch (error) {
            return describeFailure(error);
          }
        },
      }));

      pi.registerTool(defineTool({
        name: "browser_new_tab",
        label: "Browser new tab",
        description: "新开一个标签并切过去（标签上限 20，超限时回收最久未使用的 Agent 标签）。",
        executionMode: "sequential",
        parameters: Type.Object({
          url: Type.Optional(Type.String({ description: "新标签直接打开的地址" })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          try {
            const url = params.url ? assertNavigableBrowserUrl(params.url).url : undefined;
            await enforceCapacity(ctx);
            const result = await host(ctx, "newTab", url ? { payload: { url } } : {});
            const tab = tabSummary(result);
            if (tab.tabId) registry.invalidate(tab.tabId, "navigate");
            return {
              content: [{ type: "text" as const, text: `已新开标签 ${tab.tabId}${tab.url ? `：${tab.url}` : ""}` }],
              details: { tabId: tab.tabId, url: tab.url },
            };
          } catch (error) {
            return describeFailure(error);
          }
        },
      }));

      pi.registerTool(defineTool({
        name: "browser_switch_tab",
        label: "Browser switch tab",
        description: "切换 agent 的工作标签。切换后请重新 browser_observe —— 另一个标签的 ref 与这里不通用。",
        executionMode: "sequential",
        parameters: Type.Object({
          tabId: Type.String({ description: "要切换到的标签 id" }),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          try {
            const result = await host(ctx, "switchTab", { tabId: params.tabId });
            const tab = tabSummary(result);
            return {
              content: [{ type: "text" as const, text: `已切换到标签 ${params.tabId}${tab.url ? `：${tab.url}` : ""}` }],
              details: { tabId: params.tabId, url: tab.url },
            };
          } catch (error) {
            return describeFailure(error);
          }
        },
      }));

      pi.registerTool(defineTool({
        name: "browser_close",
        label: "Browser close",
        description: "关闭一个标签。标签上的 ref 随之全部失效。",
        executionMode: "sequential",
        parameters: Type.Object({
          tabId: Type.Optional(Type.String({ description: "缺省关闭当前工作标签" })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          try {
            const result = await host(ctx, "closeTab", {
              ...(params.tabId ? { tabId: params.tabId } : {}),
              payload: {},
            });
            if (params.tabId) registry.forget(params.tabId);
            return {
              content: [{ type: "text" as const, text: `已关闭标签 ${params.tabId ?? "（当前工作标签）"}` }],
              details: { tabId: params.tabId ?? null, result: isRecord(result) ? result : null },
            };
          } catch (error) {
            return describeFailure(error);
          }
        },
      }));
    },
  };
}

