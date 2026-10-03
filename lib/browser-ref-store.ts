/**
 * fork:proma-42-browser · AX-tree ref 的**世代管理**（纯逻辑）。
 *
 * 这是整套受管浏览器里最不能省的一条。`browser_observe` 交给模型的是一串短 ref
 * （`r3-17` 这样的 `r<世代>-<序号>`），模型的下一句话就可能带着这个 ref 回来点。
 * 如果页面在这中间导航过 / 重渲染过，`r3-17` 指向的**已经是另一个节点**（或者干脆不存在），
 * agent 就会点到一个已经换掉的按钮 —— 这是自动化误操作的经典来源。
 *
 * 因此规则是「一次变更，全部作废」：
 *   · 每次 observe / navigate / tab 关闭 / debugger 重连 → 该 tab 的世代 +1，旧 ref 立即失效；
 *   · ref 本身带世代前缀，`resolve()` 先比世代再比表，**两道**检查；
 *   · 宿主侧还物理清空自己的 backendNodeId 表（`electron/browser-host.js`），第三道。
 *
 * 这一层不碰 Electron、不碰 CDP，只做「给定一串元素和一堆失效事件，算出下一代的 ref 表」。
 */

export interface BrowserObservedElement {
  /** Chromium 的 backendDOMNodeId；由宿主从 AX tree 里读出。 */
  backendNodeId: number;
  role: string;
  name: string;
  editable: boolean;
}

export interface BrowserRefEntry extends BrowserObservedElement {
  ref: string;
  generation: number;
  /** 给 trace / 高亮用的人话标签，形如 `button「登录」`。 */
  label: string;
}

export interface BrowserTabRefState {
  tabId: string;
  /** 0 = 还没观察过；此后每作废一次 +1。 */
  generation: number;
  entries: Map<string, BrowserRefEntry>;
  /** 最近一次作废的原因，仅用于诊断与 trace。 */
  invalidatedReason: BrowserInvalidateReason | null;
}

export type BrowserInvalidateReason =
  | "observe"
  | "navigate"
  | "reload"
  | "tab-closed"
  | "debugger-recovered"
  | "switch-tab";

/** 观测结果交给模型之前的最后一道裁剪：条目数上限。 */
export const MAX_BROWSER_REF_ENTRIES = 400;

export class BrowserRefStaleError extends Error {
  readonly tabId: string;
  readonly ref: string;
  readonly refGeneration: number | null;
  readonly currentGeneration: number;

  constructor(tabId: string, ref: string, refGeneration: number | null, currentGeneration: number) {
    super(
      refGeneration === null || refGeneration === currentGeneration
        ? `元素引用 ${ref} 已失效，请重新调用 browser_observe。`
        : `元素引用 ${ref} 属于第 ${refGeneration} 代页面，当前是第 ${currentGeneration} 代，请重新调用 browser_observe。`,
    );
    this.name = "BrowserRefStaleError";
    this.tabId = tabId;
    this.ref = ref;
    this.refGeneration = refGeneration;
    this.currentGeneration = currentGeneration;
  }
}

export function formatBrowserRefLabel(role: string, name: string): string {
  const trimmed = name.trim().slice(0, 80);
  return trimmed ? `${role}「${trimmed}」` : role;
}

/**
 * 从 ref 字符串里读出它属于第几代（`r3-17` → 3）。读不出就返回 null。
 *
 * 用途：ref 已经不在表里（典型情况：被 invalidate 清掉了）时，靠这个前缀仍然能给
 * 模型一句**可执行**的错（「你拿的是第 1 代的 ref，现在是第 2 代，请重新 observe」），
 * 而不是干巴巴一句「已失效」。
 */
export function parseBrowserRefGeneration(ref: string): number | null {
  const match = /^r(\d+)-\d+$/.exec(ref.trim());
  if (!match) return null;
  const generation = Number(match[1]);
  return Number.isSafeInteger(generation) && generation >= 0 ? generation : null;
}

export interface PublishedRefs {
  tabId: string;
  generation: number;
  /** 与 AX tree 同序，供模型按序号读。 */
  refs: BrowserRefEntry[];
}

/**
 * 单进程内的 ref 世代表。按 tabId 分片；agent 可以同时开 20 个 tab，
 * 互相之间不共享世代，所以「A 标签导航」绝不能让 B 标签的 ref 失效。
 */
export class BrowserRefRegistry {
  private readonly tabs = new Map<string, BrowserTabRefState>();
  /** 代际已知的旧 ref 世代，用于区分「从没存在过」与「存在过但过期」。 */
  private readonly knownGenerations = new Map<string, number>();

  private state(tabId: string): BrowserTabRefState {
    let state = this.tabs.get(tabId);
    if (!state) {
      state = { tabId, generation: 0, entries: new Map(), invalidatedReason: null };
      this.tabs.set(tabId, state);
    }
    return state;
  }

  generation(tabId: string): number {
    return this.tabs.get(tabId)?.generation ?? 0;
  }

  /**
   * 作废该 tab 的**全部** ref。这是唯一的作废入口 —— 任何地方想清 ref 都必须走它，
   * 免得某条路径只清了表却没推进世代（那样旧 ref 的世代号会和新的撞上）。
   */
  invalidate(tabId: string, reason: BrowserInvalidateReason): number {
    const state = this.state(tabId);
    state.entries.clear();
    state.generation += 1;
    state.invalidatedReason = reason;
    this.knownGenerations.set(tabId, state.generation);
    return state.generation;
  }

  /** tab 彻底消失：连世代一起忘掉，后续同 id 复用时从 0 重新开始。 */
  forget(tabId: string): void {
    this.tabs.delete(tabId);
    this.knownGenerations.delete(tabId);
  }

  /**
   * 发布一次新的观测：世代 +1、清空旧表、写入新 ref。
   * observe 本身就是一次「页面可能已经变了」的声明，所以它总是开启新世代，
   * **即使连续两次 observe 之间页面一动没动** —— 让模型手里永远只有一代 ref。
   */
  publish(tabId: string, elements: readonly BrowserObservedElement[]): PublishedRefs {
    const generation = this.invalidate(tabId, "observe");
    const state = this.state(tabId);
    const refs: BrowserRefEntry[] = [];
    for (const element of elements.slice(0, MAX_BROWSER_REF_ENTRIES)) {
      const ref = `r${generation}-${refs.length + 1}`;
      const entry: BrowserRefEntry = {
        ref,
        generation,
        backendNodeId: element.backendNodeId,
        role: element.role,
        name: element.name,
        editable: element.editable,
        label: formatBrowserRefLabel(element.role, element.name),
      };
      state.entries.set(ref, entry);
      refs.push(entry);
    }
    return { tabId, generation, refs };
  }

  /**
   * 解析 ref。第一道：表里有没有；第二道：entry 的世代是不是当前世代。
   * 第二道是冗余的（invalidate 已经清表），但它让「有人在别处直接改了表」这类
   * 未来的改动也不会悄悄放过一个跨代 ref。
   */
  resolve(tabId: string, ref: string): BrowserRefEntry {
    const state = this.state(tabId);
    const entry = state.entries.get(ref);
    if (!entry) {
      // 表里没有：先看 ref 自报的世代，再退回这个 tab 已知的最后一次世代。
      const refGeneration = parseBrowserRefGeneration(ref) ?? this.knownGenerations.get(tabId) ?? null;
      throw new BrowserRefStaleError(tabId, ref, refGeneration, state.generation);
    }
    if (entry.generation !== state.generation) {
      throw new BrowserRefStaleError(tabId, ref, entry.generation, state.generation);
    }
    return entry;
  }

  size(tabId: string): number {
    return this.tabs.get(tabId)?.entries.size ?? 0;
  }

  /** 诊断用：当前有多少 tab 持有 ref、总共多少条。 */
  stats(): { tabs: number; refs: number; generations: Record<string, number> } {
    const generations: Record<string, number> = {};
    let refs = 0;
    for (const [tabId, state] of this.tabs) {
      generations[tabId] = state.generation;
      refs += state.entries.size;
    }
    return { tabs: this.tabs.size, refs, generations };
  }

  clear(): void {
    this.tabs.clear();
    this.knownGenerations.clear();
  }
}

/**
 * 进程级单例。`globalThis` 是必须的：Next 的热重载会重新求值模块，
 * 模块级 `new` 出来的表会跟着丢，agent 手里的 ref 就在一次热重载后集体失效。
 * 与 `lib/rpc-manager.ts` 的 `globalThis.__piSessions` 同一个理由。
 */
const REGISTRY_KEY = "__piWebBrowserRefRegistry";

export function getBrowserRefRegistry(): BrowserRefRegistry {
  const holder = globalThis as unknown as Record<string, unknown>;
  const existing = holder[REGISTRY_KEY];
  if (existing instanceof BrowserRefRegistry) return existing;
  const created = new BrowserRefRegistry();
  holder[REGISTRY_KEY] = created;
  return created;
}