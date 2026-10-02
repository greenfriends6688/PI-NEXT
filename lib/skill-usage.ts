// fork:proma-32-skill-usage —— 「这一轮用了哪些 skill」的纯推导。
//
// 依据：`docs/proma-borrowing-plan-2026-10-02.md` PR-32（F1）+ Proma 的
// `packages/shared/src/utils/skill-usage.ts` 与 `docs/plans/2026-08-11-skill-usage-chips.md`。
// 与 `lib/turn-written-files.ts` 同一条思路：**证据只来自工具调用**，回复正文里出现的
// skill 名不算数（模型可能只是复述了目录）。
//
// 三个不能省的约束：
//
// 1. **toolCall + toolResult 必须配对，且结果没有报错。** 裸 toolCall 只能证明模型
//    「打算读」，不证明它读到了（路径拼错、权限拒绝都会留一条 isError 的结果）。
//    失败的读不产生 chip —— 一次读不到就显示「用过这个 skill」是骗人的。
// 2. **绝不暴露绝对路径。** 返回值只有 `<slug>/SKILL.md`：转录会整段进模型上下文，
//    一个 `/Users/<用户名>/.pi/agent/skills/...` 既是多余的噪声，也泄露目录结构。
//    `mergeSkillActivations()` 连调用方传进来的 `workspaceSkillPath` 都不采信，
//    一律按校验过的 slug 重算。
// 3. **slug 是目录名，不是路径片段。** 含分隔符（`/` `\`）或点号（`.`、`..`）的一律
//    拒绝：前者挡住 `/skill:../../etc/passwd` 这类 mention，后者挡住
//    `skills/../SKILL.md` 这种靠正则 `[^/]+` 钻进来的穿越。

import { tokenizeMentions } from "./mention-tokens";
import type { AssistantMessage, SessionMessage, TextContent, ToolResultMessage, UserMessage } from "./types";

/** 触发一次 skill 的两条独立证据。渲染顺序固定，不跟流式到达顺序抖。 */
export type SkillActivationSource = "explicit" | "read";

export interface SkillActivation {
  /** `skills/` 下的目录名，已通过 slug 校验。 */
  slug: string;
  /** 展示用名字。只在用户显式 `/skill:` 敲出的拼写与 slug 不同时才有。 */
  name?: string;
  /** 至少一个来源；顺序恒为 `["explicit", "read"]`。 */
  sources: SkillActivationSource[];
  /** 恒为 `<slug>/SKILL.md`。**永远不是绝对路径。** */
  workspaceSkillPath: string;
}

/** 固定顺序的来源序：合并时按它排序，渲染才不会随流式到达顺序闪。 */
const ACTIVATION_SOURCES: readonly SkillActivationSource[] = ["explicit", "read"];

const SKILL_ENTRY_PATH_RE = /(?:^|\/)skills\/([^/]+)\/SKILL\.md$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * slug = `skills/` 下的**单个目录名**。
 *
 * 拒绝含 `/`、`\`（路径分隔符）与含 `.`（`.`、`..`，以及 `/skill:foo.md` 这种把
 * 文件名当 skill 名的 mention）的值。三者都不是合法目录名，留着只会是穿越尝试。
 */
function normalizeSkillSlug(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const slug = value.trim();
  if (slug === "") return null;
  if (slug.includes("/") || slug.includes("\\") || slug.includes(".")) return null;
  return slug;
}

/** 路径形如 `skills/<slug>/SKILL.md` 时返回 `<slug>`，否则 null。 */
export function getSkillSlugFromEntryPath(path: string): string | null {
  if (typeof path !== "string") return null;
  // Windows 的路径分隔符先归一，否则 `skills\x\SKILL.md` 永远匹配不上。
  const matched = path.replace(/\\/g, "/").match(SKILL_ENTRY_PATH_RE);
  return matched ? normalizeSkillSlug(matched[1]) : null;
}

function createActivation(slug: string, source: SkillActivationSource): SkillActivation {
  return { slug, sources: [source], workspaceSkillPath: `${slug}/SKILL.md` };
}

function orderedSources(sources: readonly unknown[]): SkillActivationSource[] {
  const seen = new Set(sources.filter((source): source is SkillActivationSource => (
    source === "explicit" || source === "read"
  )));
  return ACTIVATION_SOURCES.filter((source) => seen.has(source));
}

/**
 * 按首次出现顺序合并去重；同一 slug 的 sources 归一到 `["explicit","read"]`。
 *
 * 合并时会**重建**每条记录：`slug` 重新过校验，`workspaceSkillPath` 按 slug 重算，
 * 名字为空则回落成 slug。调用方塞进来的任何路径（哪怕是绝对路径）都不会活到返回值里。
 */
export function mergeSkillActivations(
  ...groups: ReadonlyArray<ReadonlyArray<SkillActivation>>
): SkillActivation[] {
  const merged = new Map<string, SkillActivation>();

  for (const group of groups) {
    for (const activation of group ?? []) {
      const slug = normalizeSkillSlug(activation?.slug);
      if (!slug) continue;
      const name = typeof activation.name === "string" && activation.name.trim() !== ""
        ? activation.name.trim()
        : undefined;
      const existing = merged.get(slug);
      if (!existing) {
        merged.set(slug, {
          slug,
          ...(name ? { name } : {}),
          sources: orderedSources(Array.isArray(activation.sources) ? activation.sources : []),
          workspaceSkillPath: `${slug}/SKILL.md`,
        });
        continue;
      }
      if (!existing.name && name) existing.name = name;
      existing.sources = orderedSources([...existing.sources, ...(Array.isArray(activation.sources) ? activation.sources : [])]);
    }
  }

  return [...merged.values()];
}

function isReadToolName(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return name === "read" || name.endsWith(".read") || name.endsWith("_read");
}

function readPathArgument(input: Record<string, unknown>): string | null {
  const value = input.file_path ?? input.filePath ?? input.path;
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * 一条工具调用块。pi 落盘写 `{id, name, arguments}`，`normalizeToolCalls()` 之后是
 * `{toolCallId, toolName, input}`（AGENTS.md「ToolCall field normalization」），两种都认。
 */
function readToolCallBlock(block: unknown): { id: string; toolName: string; input: Record<string, unknown> } | null {
  if (!isRecord(block) || block.type !== "toolCall") return null;
  const id = block.toolCallId ?? block.id;
  const toolName = block.toolName ?? block.name;
  const input = block.input ?? block.arguments;
  if (typeof id !== "string" || id === "") return null;
  if (typeof toolName !== "string" || toolName === "") return null;
  return isRecord(input) ? { id, toolName, input } : null;
}

function userMessageText(message: UserMessage): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((block): block is TextContent => isRecord(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

/** mention 里敲的名字与 skill 目录名常常只差大小写或空格/下划线，比一次归一形式。 */
function slugKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

/**
 * 来源 `read`：这一轮成功读到过 `skills/<slug>/SKILL.md`。
 *
 * 裸 toolCall 不算数 —— 必须等配对的结果到达且 `isError !== true`。失败的读不出 chip。
 */
export function collectSuccessfulSkillReadActivations(
  turnMessages: readonly SessionMessage[],
): SkillActivation[] {
  /** 未定论的调用：null = 这条调用读的不是 SKILL.md，等结果只是为了把它出队。 */
  const pendingReads = new Map<string, SkillActivation | null>();
  const activations: SkillActivation[] = [];

  for (const message of turnMessages ?? []) {
    if (message.role === "assistant") {
      const content = (message as AssistantMessage).content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        const call = readToolCallBlock(block);
        if (!call || !isReadToolName(call.toolName)) continue;
        const path = readPathArgument(call.input);
        const slug = path ? getSkillSlugFromEntryPath(path) : null;
        pendingReads.set(call.id, slug ? createActivation(slug, "read") : null);
      }
      continue;
    }

    if (message.role !== "toolResult") continue;
    const result = message as ToolResultMessage;
    const activation = pendingReads.get(result.toolCallId);
    // 先出队再判定：报错的结果同样要把这条调用消费掉，否则同一条调用可能被
    // 后面第二条结果复活成 chip。
    pendingReads.delete(result.toolCallId);
    if (!activation || result.isError === true) continue;
    activations.push(activation);
  }

  return mergeSkillActivations(activations);
}

/**
 * 来源 `explicit`：用户在消息里写了 `/skill:<name>`（与 skill mention 同一套切词）。
 *
 * 与 Proma 的差别：Proma 有一条 pi 不存在的 `skill_activations` 元数据，我们只能从
 * 文本里取名字，**再与上面那条读成功的证据求交集** —— 用户敲了 `/skill:x` 不等于
 * 这一轮真的用过它（模型可能压根没去读）。
 */
function collectExplicitFrom(
  turnMessages: readonly SessionMessage[],
  reads: readonly SkillActivation[],
): SkillActivation[] {
  /** 归一化键 → 用户实际敲的拼写。 */
  const mentioned = new Map<string, string>();
  for (const message of turnMessages ?? []) {
    if (message.role !== "user") continue;
    for (const segment of tokenizeMentions(userMessageText(message as UserMessage), {})) {
      if (segment.type !== "mention" || segment.token.kind !== "skill") continue;
      const name = normalizeSkillSlug(segment.token.value);
      if (!name) continue;
      mentioned.set(slugKey(name), name);
    }
  }
  if (mentioned.size === 0) return [];

  return reads.flatMap((read) => {
    const spelled = mentioned.get(slugKey(read.slug));
    if (spelled === undefined) return [];
    return [{
      slug: read.slug,
      ...(spelled !== read.slug ? { name: spelled } : {}),
      sources: ["explicit"] as SkillActivationSource[],
      workspaceSkillPath: read.workspaceSkillPath,
    }];
  });
}

export function collectExplicitSkillActivations(
  turnMessages: readonly SessionMessage[],
): SkillActivation[] {
  return mergeSkillActivations(
    collectExplicitFrom(turnMessages, collectSuccessfulSkillReadActivations(turnMessages)),
  );
}

/** 一轮汇总用：显式 + 读，两个来源合到一条按 slug 去重的列表。 */
export function collectSkillActivations(turnMessages: readonly SessionMessage[]): SkillActivation[] {
  const reads = collectSuccessfulSkillReadActivations(turnMessages);
  return mergeSkillActivations(collectExplicitFrom(turnMessages, reads), reads);
}