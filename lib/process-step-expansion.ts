/**
 * fork:step-expansion — 时间线上「哪几类步骤默认展开」。
 *
 * 时间线把一轮里的推理、命令、工具调用压成一行行步骤，点行头才展开细节。
 * 哪一类值得默认摊开因人而异（有人只想看命令输出，有人只想看推理），所以做成
 * 三档开关而不是写死。
 *
 * 2026-09-30 改默认值：推理从「默认摊开」改成**默认收起**。之前推理行一进来就
 * 掉出一大块斜体正文，而画板 11「过程时间轴」帧 A 画的是
 * `推理 <模型原话一行>` —— 正文只在点开时出现，收起态与命令 / 工具行同高，
 * 一条时间轴才读得出「这轮做了几步」。推理 / 命令 / 工具三档开关不变，
 * 想回「一进来全摊开」在设置里把推理打开即可。
 *
 * 存 localStorage，和 `pi-thinking-expanded` 同一套路；改完广播事件，让已经挂载的
 * 时间线立刻跟着变（否则要等下一次重渲染才生效）。
 */

export type StepCategory = "reasoning" | "command" | "tool";

export const STEP_CATEGORIES: readonly StepCategory[] = ["reasoning", "command", "tool"];

export const STEP_EXPANSION_EVENT = "pi-step-expansion-changed";

const STORAGE_KEY = "pi-process-step-expanded";

export type StepExpansion = Record<StepCategory, boolean>;

/** 与画板 11 帧 A 一致：三类步骤都收起，行上只留一行摘要。 */
export const DEFAULT_STEP_EXPANSION: StepExpansion = {
  reasoning: false,
  command: false,
  tool: false,
};

export function loadStepExpansion(): StepExpansion {
  const fallback = { ...DEFAULT_STEP_EXPANSION };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Record<StepCategory, unknown>>;
    for (const category of STEP_CATEGORIES) {
      if (typeof parsed?.[category] === "boolean") fallback[category] = parsed[category] as boolean;
    }
    return fallback;
  } catch {
    // 存储被禁用或内容不是 JSON：退回默认，不因为一个偏好炸掉整个时间线。
    return { ...DEFAULT_STEP_EXPANSION };
  }
}

export function saveStepExpansion(next: StepExpansion): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 存不下也照样生效本次会话。
  }
  window.dispatchEvent(new Event(STEP_EXPANSION_EVENT));
}

export function setStepCategoryExpanded(category: StepCategory, expanded: boolean): StepExpansion {
  const next = { ...loadStepExpansion(), [category]: expanded };
  saveStepExpansion(next);
  return next;
}

/**
 * 一个步骤归哪一类。
 *
 * 命令（bash）单独一类是因为它的展开内容是终端输出，体量与工具详情完全不同；
 * 其余工具调用（读文件、改文件、todo……）合并成一类，逐工具配开关没人会去点。
 */
export function stepCategoryOf(step: { reasoning?: boolean; tone?: string }): StepCategory {
  if (step.reasoning) return "reasoning";
  if (step.tone === "command_execution") return "command";
  return "tool";
}
