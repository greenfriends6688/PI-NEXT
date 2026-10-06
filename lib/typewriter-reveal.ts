/**
 * fork:typewriter-tail —— 流式尾段的打字机揭示（纯逻辑，可在 Node 里单测）。
 *
 * SSE 的 delta 是成块到的，所以尾段一坨一坨地跳。这里在**已经到达的文本**前面加一道
 * 本地游标：每帧多吐几个字，读起来像逐字输入。它不碰传输、不碰 markdown 管线，只决定
 * 「这一帧把 tail 显示到第几个字」；末尾那枚光标（`.d-caret`）因此天然跟着吐字的边缘。
 *
 * 三条约束，少了任何一条就变成负面体验：
 *  1. **绝不落后于流** —— 步长按「在 `TARGET_LAG_MS` 内排空当前积压」反推，
 *     所以显示最多落后真实内容 `TARGET_LAG_MS`，一次大 delta / 重连补齐不会让人盯着空白等；
 *  2. **不从 markdown 标记中间切** —— `safeRevealCut` 把切点回退到未闭合的行内标记
 *     之前，否则屏幕上会闪出 `**` 这种半个 token；
 *  3. **安静即落定** —— `QUIET_FLUSH_MS` 内没有新字就直接交完整文本。(2) 是启发式，
 *     (3) 是必需的兜底：它保证「被挡住的切点」不会把文字永久冻住。
 *
 * fork:typewriter-speed（2026-10-06 用户反馈「打字机效果跟傻逼一样，ZCode 吐字很快」）
 * —— 原来只有两档：3 字/帧（187 字/秒）与「积压 > 48 字就直接 48 字/帧」。
 * 遇到比 187 字/秒更快的模型时，显示会**持续落后**，然后每隔一会儿跳一大块 ——
 * 那正是用户说的观感。现在换成比例控制：步长 = 积压 / TARGET_LAG_MS，
 * 快模型下自然提速、慢模型下退回 `BASE_STEP_CHARS` 的逐字手感，两者都不会落后。
 *
 * 消费方：`hooks/useTypewriterReveal.ts` → `components/MessageView.tsx` 的
 * `StreamingTextBlock`（正文尾段）与 `ThinkingBlock`（思考正文，fork:thinking-typewriter）。
 * 正文里只有**单行行内 tail** 走这条路（围栏 / 列表 / 表格逐字吐会抖，照旧整块出）。
 * 定时器可注入，便于确定性测试（同 `lib/stream-throttle.ts`）。
 */

/** 每帧最少推进的字数 —— 4 字/帧 ≈ 250 字/秒，比多数模型吐字还快，慢流下仍有逐字感。 */
export const BASE_STEP_CHARS = 4;
/** 单帧步长上限：防一帧内把整段（重连补齐 / 超长思考）一次性画出来。 */
export const MAX_STEP_CHARS = 200;
/** 显示允许落后真实内容多久（毫秒）。步长按这个上限反推，所以它**就是**最大延迟。 */
export const TARGET_LAG_MS = 120;
/** 距离上一次新字过去这么久就整段落定。 */
export const QUIET_FLUSH_MS = 250;
/** 一帧的时长；驱动用 interval 而不是 rAF，测试里才可注入假时钟。 */
export const FRAME_MS = 16;
/**
 * 安全切点最多往回退多少字。超过说明判据在这一段上太严（比如 `snake_case_` 里那一个
 * 落单的 `_`），宁可放过一次半个标记，也不让文字在活跃流式里卡住不动。
 */
export const MAX_MARKER_BACKOFF = 96;

/** 行内标记规则：open 段数为奇数（或 open 比 close 多）= 末尾那个还没闭合。 */
const MARKER_RULES: { open: RegExp; close?: RegExp }[] = [
  { open: /`+/g }, // 行内代码
  { open: /\*+/g }, // 强调：** 是**一个**标记，不是两个
  { open: /_+/g }, // 下划线强调（snake_case 会误判 → 由上限与安静兜底）
  { open: /\[/g, close: /\]/g }, // 行内链接 / 图片
];

/**
 * ponytail: 按「段数奇偶」判闭合，不跑真正的 markdown 解析 —— 真解析要建 AST，
 * 而这里每帧都要判一次。判据刻意选成宁可放过：回退超过 MAX_MARKER_BACKOFF 就直接放行，
 * 冻住的情况由 QUIET_FLUSH_MS 兜底。
 */
function lastUnclosedMarkerStart(prefix: string): number {
  let earliest = -1;
  for (const rule of MARKER_RULES) {
    const opens = [...prefix.matchAll(rule.open)].map((match) => match.index ?? -1);
    if (opens.length === 0) continue;
    // 成对规则（`[` / `]`）看谁多；自闭合规则（强调 / 行内代码）看段数奇偶 —— `**` 是
    // **一个**标记，所以按字符数判会把 `**bold**` 误判成没收尾。
    const unclosed = rule.close
      ? opens.length > [...prefix.matchAll(rule.close)].length
      : opens.length % 2 === 1;
    if (!unclosed) continue;
    const index = opens[opens.length - 1]; // 最后一个没配上的开标记（近似）
    if (earliest < 0 || index < earliest) earliest = index;
  }
  return earliest;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * 只保证不劈开代理对（emoji / 部分 CJK 扩展区）的切点。
 *
 * 消费方是**纯文本**（思考正文）—— 那里没有 markdown 管线，回退到标记之前
 * 只会在一个未闭合的 `` ` `` / `*` / `_` 上把文字冻住，等闭合符号到才跳一大块。
 */
export function plainRevealCut(text: string, target: number): number {
  const cut = Math.min(Math.max(0, Math.trunc(target)), text.length);
  return cut > 0 && cut < text.length && isHighSurrogate(text.charCodeAt(cut - 1)) ? cut - 1 : cut;
}

/**
 * 把「显示到第 target 个字」修正成一个**安全切点**：不劈开代理对，也不在未闭合的行内
 * 标记中间切开。返回的切点 ≤ target。
 */
export function safeRevealCut(text: string, target: number): number {
  let cut = plainRevealCut(text, target);
  const marker = lastUnclosedMarkerStart(text.slice(0, cut));
  if (marker >= 0 && cut - marker <= MAX_MARKER_BACKOFF) cut = marker;
  return cut;
}

/**
 * 待吐 pending 个字时，这一帧推进多少字。
 *
 * 比例控制：步长 = 「在 `TARGET_LAG_MS` 内排空积压」，下限 `BASE_STEP_CHARS`
 * （慢流下的逐字手感）、上限 `MAX_STEP_CHARS`（防一帧画整段）。
 *
 * 与旧写法的差别：旧写法是「积压 ≤48 就走 3 字/帧」的硬两档，比它快的模型会让显示
 * 持续落后、然后每隔一会儿跳一大块；比例控制下最大延迟恒为 `TARGET_LAG_MS`，
 * 所以「吐字很快」与「不跳大块」可以同时成立。
 */
export function revealStep(pending: number): number {
  if (pending <= 0) return 0;
  const proportional = Math.ceil((pending * FRAME_MS) / TARGET_LAG_MS);
  return Math.min(MAX_STEP_CHARS, Math.max(BASE_STEP_CHARS, proportional));
}

export interface TypewriterTimers {
  setIntervalFn?: (handler: () => void, ms: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
  setTimeoutFn?: (handler: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export interface Typewriter {
  /** 记录最新文本（流式每次 delta 调一次），必要时开始逐帧推进。 */
  push(text: string): void;
  /**
   * 把当前文本当作「已经吐完」—— **启用揭示的那一刻**调用。
   * 少了它，切分支 / 折叠再展开 / 刷新后重新挂载时，屏幕上已经存在的整段文字
   * 会被从第一个字重打一遍。
   */
  seed(text: string): void;
  /** 归零并停表 —— 调用方切到非打字机形态时用。 */
  reset(): void;
  dispose(): void;
  /** 已显示的字数。 */
  cut(): number;
  /** 是否还有字没吐出来。 */
  pending(): boolean;
}

export interface TypewriterOptions {
  /** 切点修正函数。默认 `safeRevealCut`（markdown）；纯文本消费方传 `plainRevealCut`。 */
  safeCut?: (text: string, target: number) => number;
}

/**
 * 打字机驱动器。只在「有字没吐完」时挂着 interval，吐完即停 —— 一个收尾的
 * streaming tail 上不留定时器。
 */
export function createTypewriter(
  onUpdate: (cut: number) => void,
  timers: TypewriterTimers = {},
  options: TypewriterOptions = {},
): Typewriter {
  const safeCut = options.safeCut ?? safeRevealCut;
  const setIntervalFn = timers.setIntervalFn ?? ((handler, ms) => setInterval(handler, ms));
  const clearIntervalFn = timers.clearIntervalFn ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
  const setTimeoutFn = timers.setTimeoutFn ?? ((handler, ms) => setTimeout(handler, ms));
  const clearTimeoutFn = timers.clearTimeoutFn ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let latest = "";
  let shown = 0;
  let frameTimer: unknown = null;
  let quietTimer: unknown = null;
  let disposed = false;

  const stopFrames = () => {
    if (frameTimer !== null) {
      clearIntervalFn(frameTimer);
      frameTimer = null;
    }
  };
  const stopQuiet = () => {
    if (quietTimer !== null) {
      clearTimeoutFn(quietTimer);
      quietTimer = null;
    }
  };
  const stop = () => {
    stopFrames();
    stopQuiet();
  };

  const flush = () => {
    stop();
    if (shown === latest.length) return;
    shown = latest.length;
    onUpdate(shown);
  };

  const frame = () => {
    const pending = latest.length - shown;
    if (pending <= 0) {
      stopFrames();
      return;
    }
    const next = safeCut(latest, shown + revealStep(pending));
    // 切点被安全判据挡住时这一帧不动，等新字（或安静兜底）再来推。
    if (next > shown) {
      shown = next;
      onUpdate(shown);
    }
    if (shown >= latest.length) stopFrames();
  };

  return {
    push(text: string) {
      if (disposed) return;
      if (text.length < shown) shown = text.length; // 文本换短了（重开 / 切分支）：别停在旧位置
      const grew = text.length > latest.length;
      latest = text;
      if (shown >= latest.length) {
        stop();
        return;
      }
      if (grew) {
        stopQuiet();
        quietTimer = setTimeoutFn(flush, QUIET_FLUSH_MS);
      }
      if (frameTimer === null) frameTimer = setIntervalFn(frame, FRAME_MS);
    },
    reset() {
      stop();
      latest = "";
      shown = 0;
    },
    seed(text: string) {
      if (disposed) return;
      stop();
      latest = text;
      shown = text.length;
      onUpdate(shown);
    },
    dispose() {
      disposed = true;
      stop();
    },
    cut: () => shown,
    pending: () => shown < latest.length,
  };
}