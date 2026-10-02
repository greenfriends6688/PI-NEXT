import { readFileSync } from "fs";
import path from "path";
import { Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots } from "./file-access";
import { createEntry, resolveRealParent, writeTextFile, type MutationOutcome } from "./file-mutations";
import { hasParentDirectorySegment, isExistingPathWithinRoots, isPathWithinRoots } from "./path-security";
import {
  MAX_PLAN_DOCUMENT_BYTES,
  PLAN_DOCUMENTS_DIRECTORY,
  PLAN_DOCUMENTS_PER_SESSION_LIMIT,
  PLAN_DOCUMENT_MAX_TITLE_LENGTH,
  PLAN_DOCUMENT_SLUG_MAX_LENGTH,
  PLAN_TOOL_DETAILS_KIND,
  isPlanDocumentPath,
  isPlanToolDetails,
  isPlanToolName,
  planDocumentFileName,
  planDocumentRelativePath,
  planDocumentTitleFromFileName,
  planDocumentsDirectory,
  type PlanDocumentReference,
  type PlanToolAction,
  type PlanToolDetails,
  type PlanToolName,
} from "./plan-documents";

/**
 * fork:pr52-plan-tools — 计划文档的两个工具（`write_plan` / `read_plan`）。
 *
 * ## 为什么是工具而不是 skill
 *
 * `AGENTS.md` §「产品能力不许降级成 skill」的三问：`write_plan` **改状态**（写文件），
 * 用户还要**从界面点开**那份计划。两问都答「是」，所以它必须是
 * `lib/<name>-extension.ts` 的一方扩展 + 一个可点的 UI 组件，而不是一段模型「可能想起来读」的 markdown。
 *
 * ## 它和计划模式、todo 的分工（为什么不合并）
 *
 * · `lib/plan-mode.ts` 是**权限档**（能不能动手），本文件是**产物**（打算怎么做，写成文件）。
 *   计划模式的产物此前只是一段消息文本，写完就淹没在对话里。
 * · `todo` 是**执行清单**（agent 边做边勾，状态在 tool result 的 `details` 里，不落盘），
 *   本文件是**给人读的计划文档**（落盘、可点开、可跨会话引用）。两者只互相点名，不共享存储 ——
 *   完整理由写在 `lib/plan-documents.ts` 的头注里。
 *
 * ## 计划模式下的放行（本扩展不自己开后门）
 *
 * 计划档目前拦下一切非只读动作（`lib/plan-mode.ts`），而计划模式恰恰是写计划的主场景。
 * 本文件**不给自己的工具开后门** —— 拿扩展特权去抵消用户的权限档，比功能缺失严重得多。
 * `isPlanArtifactToolCall()`（`lib/plan-documents.ts`，已单测）是交给计划档用的判据：
 * 在 `decidePlanModeToolCall` 判成 read-only 之前加一条放行即可，与 Proma
 * `agent-plan-file-policy.ts` / `agent-orchestrator.ts:1449` 同款。
 *
 * ## 状态在哪
 *
 * 与 `todo` 同一套 SDK 状态模式：写成功的路径记在 tool result 的 `details` 里，
 * `session_start` / `session_tree` 时从**当前分支**重建 —— 分支切换与 fork 会连计划清单一起回退。
 *
 * ## 落盘
 *
 * 逐级建目录 + 建空文件都走 `lib/file-mutations.ts` 的既有原语（每一级都过一次 realpath 授权），
 * 内容替换走 `writeTextFile`（staging → `renameSync`）。本文件不写第二份原子写实现。
 */

export const HOST_PLAN_TOOLS_EXTENSION_NAME = "pi-web-plan-tools";

export interface PlanToolsExtensionOptions {
  /** 测试注入点：默认 `getAllowedFileRoots()`（会话 cwd / projectRoot / 显式放行的根）。 */
  getRoots?: () => Promise<Set<string>> | Set<string>;
  /** 测试注入点：默认 `new Date()`，决定文件名里的日期戳与 `updatedAt`。 */
  now?: () => Date;
}

interface PlanToolsState {
  /** 本分支写过的计划文档，按写入顺序（最近写的那份在最后）。 */
  documents: PlanDocumentReference[];
}

const EMPTY_STATE: PlanToolsState = { documents: [] };

function pathKey(filePath: string): string {
  return filePath.replace(/\\/g, "/").toLowerCase();
}

function referenceFromDetails(details: PlanToolDetails): PlanDocumentReference {
  return {
    filePath: details.filePath,
    fileName: details.fileName,
    relativePath: details.relativePath,
    title: details.title ?? planDocumentTitleFromFileName(details.fileName),
    bytes: details.bytes,
    updatedAt: details.updatedAt,
    absolute: true,
  };
}

function reconstructFromBranch(ctx: ExtensionContext): PlanToolsState {
  const documents: PlanDocumentReference[] = [];
  const index = new Map<string, number>();
  for (const entry of ctx.sessionManager.getBranch()) {
    const message = entry.type === "message" ? entry.message : undefined;
    if (!message || message.role !== "toolResult" || !isPlanToolName(message.toolName ?? "")) continue;
    const details = (message as { details?: unknown }).details;
    if (!isPlanToolDetails(details) || details.error || details.tool !== "write_plan") continue;
    const reference = referenceFromDetails(details);
    const key = pathKey(details.filePath);
    const existing = index.get(key);
    // 同一份文件被改版就是覆盖：留在原位，只换元数据（会话里「写过几份」才是清单该显示的东西）。
    if (existing === undefined) {
      index.set(key, documents.length);
      documents.push(reference);
    } else {
      documents[existing] = reference;
    }
  }
  return documents.length ? { documents } : EMPTY_STATE;
}

interface PlanFailureInput {
  filePath?: string;
  fileName?: string;
  relativePath?: string;
  title?: string;
}

function toolResult(
  tool: PlanToolName,
  action: PlanToolAction,
  details: PlanToolDetails,
  text: string,
  isError = false,
) {
  return {
    content: [{ type: "text" as const, text }],
    details,
    ...(isError ? { isError: true as const } : {}),
  };
}

/** 失败也是一条完整的 details：UI 照样认得出「这是哪份计划」，只是标成错的。 */
function failureResult(
  tool: PlanToolName,
  action: PlanToolAction,
  input: PlanFailureInput,
  error: string,
  text: string,
) {
  return toolResult(
    tool,
    action,
    {
      kind: PLAN_TOOL_DETAILS_KIND,
      tool,
      action,
      filePath: input.filePath ?? "",
      fileName: input.fileName ?? "",
      relativePath: input.relativePath ?? "",
      ...(input.title ? { title: input.title } : {}),
      bytes: 0,
      updatedAt: "",
      error,
    },
    text,
    true,
  );
}

function denied(message: string): MutationOutcome {
  return { ok: false, error: message, status: 403 };
}

/**
 * 校验并授权一个候选路径。**授权只走 `lib/path-security.ts`**，本文件不写第二份路径校验。
 *
 * 顺序：先拒 `..`（`hasParentDirectorySegment`），再词法 `isPathWithinRoots`。
 * 已存在的文件再由调用方补一次 `isExistingPathWithinRoots`（realpath 后复核，挡符号链接）。
 */
function authorizePlanPath(candidate: string, roots: Set<string>): MutationOutcome {
  if (hasParentDirectorySegment(candidate)) {
    return { ok: false, error: "Path must not contain '..'", status: 400 };
  }
  if (!isPathWithinRoots(candidate, roots)) {
    return denied("Access denied");
  }
  return { ok: true };
}

/** 逐级建 `.pi/plans/`，每一级都过一次 realpath 授权（`resolveRealParent`），不裸 `mkdir -p`。 */
function ensurePlanDirectory(cwd: string, roots: Set<string>): MutationOutcome {
  let current = path.resolve(cwd);
  if (!isPathWithinRoots(current, roots)) return denied("Access denied");
  for (const segment of PLAN_DOCUMENTS_DIRECTORY.split("/")) {
    const next = path.join(current, segment);
    // dirname(next) === current：这一步同时复核了「当前目录在 roots 内」和「它的 realpath 也在 roots 内」。
    const parent = resolveRealParent(next, roots);
    if (!parent.ok) return parent;
    const created = createEntry(parent.directory, segment, "directory");
    // EEXIST 正是我们要的（目录已存在）；权限、路径不是目录等错误如实上浮。
    if (!created.ok && created.status !== 409) return created;
    current = next;
  }
  return { ok: true };
}

export function createPlanToolsExtension(options: PlanToolsExtensionOptions = {}): InlineExtension {
  const now = options.now ?? (() => new Date());
  const getRoots = async (): Promise<Set<string>> =>
    options.getRoots ? await options.getRoots() : await getAllowedFileRoots();

  return {
    name: HOST_PLAN_TOOLS_EXTENSION_NAME,
    hidden: true,
    factory: (pi: ExtensionAPI) => {
      let state: PlanToolsState = EMPTY_STATE;
      const reconstruct = (ctx: ExtensionContext) => {
        state = reconstructFromBranch(ctx);
      };

      pi.on("session_start", async (_event, ctx) => reconstruct(ctx));
      pi.on("session_tree", async (_event, ctx) => reconstruct(ctx));

      const record = (reference: PlanDocumentReference) => {
        const key = pathKey(reference.filePath);
        const existing = state.documents.findIndex((document) => pathKey(document.filePath) === key);
        if (existing === -1) {
          state = { documents: [...state.documents, reference] };
          return;
        }
        const documents = [...state.documents];
        documents[existing] = reference;
        state = { documents };
      };

      const writeFailure = (
        action: PlanToolAction,
        input: PlanFailureInput,
        error: string,
        text: string,
      ) => failureResult("write_plan", action, input, error, text);

      pi.registerTool(defineTool({
        name: "write_plan",
        label: "Write Plan",
        description: [
          "Write this session's plan document to disk so the user can open, review and share it.",
          "Where it lands: `<session cwd>/.pi/plans/YYYY-MM-DD-<slug>.md` — the file name comes from the",
          "title, so revising a plan overwrites the same file instead of littering the project with versions.",
          "Use a short ASCII English title (the file name is derived from it); write the prose in `content`.",
          "This is the plan **document**, not the execution list: pair it with `todo` once the work starts, so",
          "the plan is what the human reviews and the todo list is what you tick as you go.",
          "It refuses any path outside this session's `.pi/plans/` directory — it is not a general file writer.",
        ].join("\n"),
        promptSnippet: "Write this session's plan to a reviewable Markdown document the user can open",
        promptGuidelines: [
          "When a task needs the user's approval before code changes, write the plan document first and say its path, so the user can open and read it.",
          "Revise the same title to update a plan; choose a different title only when the work is genuinely a different plan.",
        ],
        executionMode: "sequential",
        parameters: Type.Object({
          title: Type.String({
            description: `Short ASCII English title; the file name becomes the date + slug (slug capped at ${PLAN_DOCUMENT_SLUG_MAX_LENGTH} chars)`,
          }),
          content: Type.String({
            description: `The full plan in Markdown (max ${Math.floor(MAX_PLAN_DOCUMENT_BYTES / 1024)} KB)`,
          }),
          path: Type.Optional(Type.String({
            description: "Absolute path of a plan document in this session's .pi/plans/ to revise. Defaults to the file derived from `title`.",
          })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          const title = params.title.trim().slice(0, PLAN_DOCUMENT_MAX_TITLE_LENGTH);
          if (!title) {
            return writeFailure("created", {}, "title is empty", "Error: title is required.");
          }
          const content = params.content;
          const bytes = Buffer.byteLength(content, "utf8");
          if (!content.trim()) {
            return writeFailure("created", { title }, "content is empty", "Error: content must not be empty.");
          }
          if (bytes > MAX_PLAN_DOCUMENT_BYTES) {
            return writeFailure(
              "created",
              { title },
              `content is ${bytes} bytes`,
              `Error: the plan document would be ${bytes} bytes; the limit is ${MAX_PLAN_DOCUMENT_BYTES}. Write a shorter plan.`,
            );
          }

          const cwd = path.resolve(ctx.cwd);
          const roots = await getRoots();
          const planDirectory = path.resolve(planDocumentsDirectory(cwd));
          const requested = params.path?.trim();

          let target: string;
          let relativePath: string;
          let rejected: { error: string; text: string } | null = null;
          if (requested) {
            // 三道门，顺序是「先安全、再语义」：绝对 → 无 `..` → 在 roots 里 → 是计划文档。
            // 反过来的话，一条越权路径会被报成「不是计划文档」，模型看到的是错误的原因。
            // `..` 必须在 resolve **之前**判：`path.resolve` 会把 `..` 消掉，到时候已经看不见了
            // （`hasParentDirectorySegment` 拒的就是这种字面量，见 lib/path-security.ts 头注 #748）。
            if (!path.isAbsolute(requested)) {
              return writeFailure(
                "updated",
                { title, filePath: requested },
                "path is not absolute",
                `Error: path must be absolute. The plan document for "${title}" is ${planDirectory}/<date>-<slug>.md.`,
              );
            }
            if (hasParentDirectorySegment(requested)) {
              return writeFailure(
                "updated",
                { title, filePath: requested },
                "path must not contain '..'",
                `Error: ${requested} contains "..". Pass the resolved plan path instead.`,
              );
            }
            target = path.resolve(requested);
            relativePath = planDocumentRelativePath(target) ?? path.basename(target);
          } else {
            const fileName = planDocumentFileName(title, now());
            target = path.join(planDirectory, fileName);
            relativePath = `${PLAN_DOCUMENTS_DIRECTORY}/${fileName}`;
          }

          const action: PlanToolAction = state.documents.some((document) => pathKey(document.filePath) === pathKey(target))
            ? "updated"
            : "created";

          const authorized = authorizePlanPath(target, roots);
          if (!authorized.ok) {
            return writeFailure(
              action,
              { title, filePath: target, relativePath },
              authorized.error,
              `Error: ${authorized.error} (${target}). Plan documents may only be written inside the session's allowed roots.`,
            );
          }

          // 显式 path 只在本会话的计划目录里改档；别的文件一律拒绝（这是计划工具，不是通用写文件口）。
          if (requested && (path.dirname(target) !== planDirectory || !isPlanDocumentPath(target))) {
            rejected = {
              error: "path is not a plan document in this session's plan directory",
              text: `Error: ${target} is not a plan document of this session. Plan documents live in ${planDirectory} and look like ${PLAN_DOCUMENTS_DIRECTORY}/<date>-<slug>.md.`,
            };
          }
          if (rejected) {
            return writeFailure(action, { title, filePath: target, relativePath }, rejected.error, rejected.text);
          }

          if (action === "created" && state.documents.length >= PLAN_DOCUMENTS_PER_SESSION_LIMIT) {
            return writeFailure(
              "created",
              { title, filePath: target, relativePath },
              "session plan limit reached",
              `Error: this session already has ${state.documents.length} plan documents (limit ${PLAN_DOCUMENTS_PER_SESSION_LIMIT}). Update one of them instead of starting another.`,
            );
          }

          const directory = ensurePlanDirectory(cwd, roots);
          if (!directory.ok) {
            return writeFailure(
              action,
              { title, filePath: target, relativePath },
              directory.error,
              `Error: could not create ${PLAN_DOCUMENTS_DIRECTORY}/ — ${directory.error}.`,
            );
          }

          if (action === "updated") {
            // 已存在：realpath 复核一次（符号链接 / 被移出 roots 都在这里挡住）。
            if (!isExistingPathWithinRoots(target, roots)) {
              return writeFailure(
                "updated",
                { title, filePath: target, relativePath },
                "target is not an existing file within roots",
                `Error: ${target} does not resolve to an existing file inside the allowed roots.`,
              );
            }
          } else {
            const parent = resolveRealParent(target, roots);
            if (!parent.ok) {
              return writeFailure(
                "created",
                { title, filePath: target, relativePath },
                parent.error,
                `Error: ${parent.error} (${path.dirname(target)}).`,
              );
            }
            // 建空文件 + writeTextFile 原子替换：落盘走的是既有的一条路径，本文件不另写一份。
            const created = createEntry(parent.directory, path.basename(target), "file");
            if (!created.ok && created.status !== 409) {
              return writeFailure(
                "created",
                { title, filePath: target, relativePath },
                created.error,
                `Error: could not create the plan document — ${created.error}.`,
              );
            }
          }

          const written = writeTextFile(target, content, roots);
          if (!written.ok) {
            return writeFailure(
              action,
              { title, filePath: target, relativePath },
              written.error,
              `Error: could not write the plan document — ${written.error}.`,
            );
          }

          const details: PlanToolDetails = {
            kind: PLAN_TOOL_DETAILS_KIND,
            tool: "write_plan",
            action,
            filePath: target,
            fileName: path.basename(target),
            relativePath,
            title,
            bytes,
            updatedAt: now().toISOString(),
          };
          record(referenceFromDetails(details));
          return toolResult(
            "write_plan",
            action,
            details,
            [
              `Plan ${action === "created" ? "written" : "updated"}: ${target}`,
              `${bytes} bytes in ${details.fileName}. The user can open it straight from this message.`,
            ].join("\n"),
          );
        },
      }));

      pi.registerTool(defineTool({
        name: "read_plan",
        label: "Read Plan",
        description: [
          "Read a plan document back. Without `path` this reads the plan this session wrote most recently.",
          "Use it before carrying out an approved plan, so you work from what the user actually reviewed.",
          "Only plan documents (`.pi/plans/*.md`) inside the allowed roots can be read.",
        ].join("\n"),
        promptSnippet: "Read back a plan document this session wrote",
        executionMode: "parallel",
        parameters: Type.Object({
          path: Type.Optional(Type.String({
            description: "Absolute path of a plan document. Defaults to the one this session wrote most recently.",
          })),
        }),
        async execute(_toolCallId, params) {
          // 不带 path 时读的是「本会话最近写的那份」，路径来自分支里重建出来的清单，
          // 因此不依赖 cwd —— 换目录也读同一份会话计划。
          const requested = params.path?.trim();
          const target = requested
            ? (path.isAbsolute(requested) ? path.resolve(requested) : "")
            : (state.documents[state.documents.length - 1]?.filePath ?? "");
          const reference = state.documents.find((document) => pathKey(document.filePath) === pathKey(target));
          const relativePath = reference?.relativePath
            ?? (target ? planDocumentRelativePath(target) ?? path.basename(target) : "");

          if (requested && !target) {
            return failureResult(
              "read_plan",
              "read",
              { filePath: requested },
              "path is not absolute",
              `Error: path must be absolute (got ${requested}).`,
            );
          }
          // `..` 必须在 resolve **之前**判（与 write_plan 同理）：hasParentDirectorySegment 拒的
          // 就是这种字面量，`path.resolve` 会把它消掉。
          if (requested && hasParentDirectorySegment(requested)) {
            return failureResult(
              "read_plan",
              "read",
              { filePath: requested },
              "path must not contain '..'",
              `Error: ${requested} contains "..". Pass the resolved plan path instead.`,
            );
          }
          if (!target) {
            return failureResult(
              "read_plan",
              "read",
              {},
              "no plan document yet",
              "Error: this session has no plan document yet. Write one with write_plan first.",
            );
          }
          if (!isPlanDocumentPath(target)) {
            return failureResult(
              "read_plan",
              "read",
              { filePath: target, relativePath },
              "not a plan document",
              `Error: ${target} is not a plan document (expected ${PLAN_DOCUMENTS_DIRECTORY}/<date>-<slug>.md).`,
            );
          }

          const roots = await getRoots();
          const authorized = authorizePlanPath(target, roots);
          if (!authorized.ok || !isExistingPathWithinRoots(target, roots)) {
            return failureResult(
              "read_plan",
              "read",
              { filePath: target, relativePath },
              authorized.ok ? "not an existing file within roots" : authorized.error,
              `Error: ${target} is not readable inside the allowed roots.`,
            );
          }

          let content: string;
          try {
            content = readFileSync(target, "utf8");
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return failureResult(
              "read_plan",
              "read",
              { filePath: target, relativePath },
              message,
              `Error: could not read the plan document — ${message}.`,
            );
          }
          const bytes = Buffer.byteLength(content, "utf8");
          if (bytes > MAX_PLAN_DOCUMENT_BYTES) {
            return failureResult(
              "read_plan",
              "read",
              { filePath: target, relativePath },
              `plan document is ${bytes} bytes`,
              `Error: ${target} is larger than the ${MAX_PLAN_DOCUMENT_BYTES} byte plan limit.`,
            );
          }

          const details: PlanToolDetails = {
            kind: PLAN_TOOL_DETAILS_KIND,
            tool: "read_plan",
            action: "read",
            filePath: target,
            fileName: path.basename(target),
            relativePath,
            ...(reference?.title ? { title: reference.title } : {}),
            bytes,
            updatedAt: now().toISOString(),
          };
          return toolResult("read_plan", "read", details, `${target}\n\n${content}`);
        },
      }));
    },
  };
}

