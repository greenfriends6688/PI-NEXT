/**
 * fork:pr52-plan-documents — 计划文档的**纯逻辑层**（零 import，浏览器也能 import）。
 *
 * ## 它回答什么问题
 *
 * 本仓的计划模式（`lib/plan-mode.ts`）是**权限档**，不是文档：它只做一次判定（非只读动作 → 拦），
 * 计划模式的全部产物是聊天里一段编号列表，写完就被下一轮对话淹没。本模块补上另一半 ——
 * 「计划文档**落在哪、叫什么、一会话几个**」，以及**从消息里认出计划文件**。
 *
 * ## 为什么不碰 todo（后来的人请读这段）
 *
 * `lib/todo-extension.ts` 的 `todo` 与计划文档是两个正交的东西，**不合并**：
 *
 * · **todo 是执行清单**，消费者是正在跑的那一轮 agent（下一轮勾掉哪一项）：半秒级刷新、
 *   条目一句话、格式 `- [ ]`、状态只活在 tool result 的 `details` 里、随分支回退、**不落盘**。
 * · **计划文档是给人看的计划**，消费者是要审批的人（点开读一遍、审、批、照着做）：整篇 Markdown、
 *   必须落盘（点得开、能进版本库、能被别的会话引用）。
 *
 * 合成一个东西必然两头不讨好：塞进 todo 的 `details` 放不下整篇计划、点不开、不能跨会话引用；
 * 每次勾选都重写文件，执行痕迹就变成一堆文件快照。本模块一个字节都不碰 todo 的存储。
 * 两者只保留一条**指针**：`write_plan` / `read_plan` 的工具描述里点名 todo，让模型自己
 * 「计划文档 ↔ 执行清单」串起来，**不共享存储、不自动同步**（自动同步就是两份真相）。
 *
 * ## 为什么这个模块不 import `path` / `lib/path-security.ts`
 *
 * `lib/path-security.ts`（`isPathWithinRoots` / `isExistingPathWithinRoots` /
 * `hasParentDirectorySegment`）import `fs`，只有服务端能用；`lib/plan-documents.ts`
 * 会被 React 组件 import。所以分工是：
 *
 * · 本模块只做**构造**与**识别**（词法），且构造出来的 slug 只含 `[a-z0-9-]`，
 *   因此「自己生成」的路径里不可能出现 `..`；
 * · **授权**全部留给服务端那一层（`lib/plan-tools-extension.ts`），并且只许走
 *   `lib/path-security.ts` 那三个函数 —— 这是安全边界，**不许在本模块里另写一份**。
 *
 * ## 路径为什么用字符串处理而不是 `path.join`
 *
 * 同上：这个模块要进浏览器 bundle（`next.config.mjs` 没给 `path` 配 fallback）。
 * 全模块统一用正斜杠做词法判断，只在**生成**要交给 fs 的路径时按平台选分隔符。
 */

export const PLAN_DOCUMENTS_DIRECTORY = ".pi/plans";
export const PLAN_DOCUMENT_EXTENSION = ".md";
export const PLAN_DOCUMENT_DIR_SEGMENTS = [".pi", "plans"] as const;

/** 一个会话最多几份计划文档（第一份是「本会话当前那份」，其余必须显式 path 另立）。 */
export const PLAN_DOCUMENTS_PER_SESSION_LIMIT = 8;

/** 计划文档是给人读的文档，不是日志：256 KB 足够写一份方案，也挡住了把文件当数据通道用。 */
export const MAX_PLAN_DOCUMENT_BYTES = 256 * 1024;

/** 一条消息里最多认出几个计划引用（防止一条长消息渲染出一片卡片）。 */
export const PLAN_DOCUMENT_MAX_REFERENCES = 8;

/** 标题长度上限：文件名里的 slug 会被截到 48，剩下的只是给人看的元数据。 */
export const PLAN_DOCUMENT_MAX_TITLE_LENGTH = 120;

export const PLAN_DOCUMENT_SLUG_MAX_LENGTH = 48;
export const PLAN_DOCUMENT_FALLBACK_SLUG = "plan";

export const PLAN_TOOL_DETAILS_KIND = "pi-web-plan";

export const PLAN_TOOL_NAMES = ["write_plan", "read_plan"] as const;
export type PlanToolName = (typeof PLAN_TOOL_NAMES)[number];

/**
 * 禁占用的保留工具名（子代理控制面）。
 *
 * `lib/subagents.ts` 把这三个名字留给委派协议；宿主扩展注册同名工具会让
 * `preferPiWebSubagentExtension` 的冲突消解做出错误判断，所以本模块自带一份断言，
 * 由 `lib/plan-documents.test.mjs` 盯着 `PLAN_TOOL_NAMES` 不许长成它们。
 */
export const RESERVED_SUBAGENT_TOOL_NAMES = ["Agent", "get_subagent_result", "steer_subagent"] as const;

export type PlanToolAction = "created" | "updated" | "read";

export interface PlanToolDetails {
  kind: typeof PLAN_TOOL_DETAILS_KIND;
  tool: PlanToolName;
  action: PlanToolAction;
  /** 绝对路径（服务端算），UI 直接拿它调 `onOpenFile` 复用 FileViewer 的 tab。 */
  filePath: string;
  fileName: string;
  /** `.pi/plans/2026-10-02-login-flow.md`，给用户看，不给 fs 用。 */
  relativePath: string;
  title?: string;
  bytes: number;
  updatedAt: string;
  error?: string;
}

export interface PlanDocumentReference {
  filePath: string;
  fileName: string;
  relativePath: string;
  title?: string;
  bytes?: number;
  updatedAt?: string;
  /** 正文里写的是绝对路径吗（相对路径靠 `cwd` 才解析得出来）。 */
  absolute: boolean;
}

const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;

function toSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

/** 一眼看上去是不是 Windows 绝对路径（`D:\repo`、`\\server\share`）。 */
export function looksAbsolute(filePath: string): boolean {
  return filePath.startsWith("/") || WINDOWS_ABSOLUTE_RE.test(filePath) || filePath.startsWith("\\\\");
}

/** 去掉结尾多余的分隔符，但保留 `/` 与 `C:\` 这种根。 */
function trimTrailingSeparators(value: string): string {
  let end = value.length;
  while (end > 1 && (value[end - 1] === "/" || value[end - 1] === "\\")) end -= 1;
  return value.slice(0, end);
}

function joinPath(directory: string, relative: string): string {
  const base = trimTrailingSeparators(directory);
  const windows = WINDOWS_ABSOLUTE_RE.test(base) || base.startsWith("\\\\");
  const separator = windows ? "\\" : "/";
  return `${base}${separator}${windows ? relative.replace(/\//g, "\\") : relative}`;
}

/** 会话的计划文档目录绝对路径（`session cwd` 里的 `.pi/plans/`）。 */
export function planDocumentsDirectory(cwd: string): string {
  return joinPath(cwd, PLAN_DOCUMENTS_DIRECTORY);
}

/**
 * 标题 → 文件名 slug。
 *
 * NFKD 折叠 + 小写 + 非 `[a-z0-9]` 折叠成 `-`：中文标题会整体塌成空，于是回落到 `plan` ——
 * 这是刻意的（工具描述要求标题用英文短语，中文正文写进 content），因为一个全中文的 slug
 * 在任何终端与文件系统里都不好读。
 */
export function planDocumentSlug(title: string | undefined): string {
  const folded = (title ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const clipped = folded.slice(0, PLAN_DOCUMENT_SLUG_MAX_LENGTH).replace(/-+$/g, "");
  return clipped || PLAN_DOCUMENT_FALLBACK_SLUG;
}

/** 会话本地当天（不是 UTC：文件名是给人看的）。 */
export function planDocumentDateStamp(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** `<YYYY-MM-DD>-<slug>.md` */
export function planDocumentFileName(title: string | undefined, now: Date): string {
  return `${planDocumentDateStamp(now)}-${planDocumentSlug(title)}${PLAN_DOCUMENT_EXTENSION}`;
}

/** 不带 path 的 `write_plan` 写到的那个文件（第一次创建，之后覆盖同一份）。 */
export function planDocumentPath(cwd: string, title: string | undefined, now: Date): string {
  return joinPath(planDocumentsDirectory(cwd), planDocumentFileName(title, now));
}

/**
 * 这条路径**看起来**是不是一个计划文档（`.pi/plans/<名字>.md`，扁平一层，不许 `..`）。
 *
 * 这是**识别**，不是授权：它只用来认出「正文里提到的那个文件」和「显式 path 只准落在计划目录」，
 * 真正的放行由服务端的 `isPathWithinRoots` / `isExistingPathWithinRoots` 决定。
 * 浏览器侧一个字节的路径校验都不加 —— 服务端不认就是 403。
 */
export function isPlanDocumentPath(candidate: string): boolean {
  if (typeof candidate !== "string" || !candidate) return false;
  if (candidate !== trimTrailingSeparators(candidate)) return false; // 结尾带分隔符 = 目录，不是文件
  if (!looksAbsolute(candidate)) return false; // 相对路径要靠 cwd 解析过之后才谈得上「在计划目录里」
  const segments = toSlashes(candidate).split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === "..")) return false;
  const fileName = segments[segments.length - 1] ?? "";
  if (!fileName.toLowerCase().endsWith(PLAN_DOCUMENT_EXTENSION)) return false;
  // 计划目录是平铺的：`plans/2026-10-02-x.md`，不允许再往里套一层。
  if (segments.length < PLAN_DOCUMENT_DIR_SEGMENTS.length + 1) return false;
  const directoryStart = segments.length - 1 - PLAN_DOCUMENT_DIR_SEGMENTS.length;
  return PLAN_DOCUMENT_DIR_SEGMENTS.every((segment, index) => segments[directoryStart + index] === segment);
}

/** 从绝对路径取回给用户看的相对路径（`.pi/plans/x.md`），不是计划文档则 `null`。 */
export function planDocumentRelativePath(filePath: string): string | null {
  if (!isPlanDocumentPath(filePath)) return null;
  const segments = toSlashes(filePath).split("/").filter((segment) => segment.length > 0);
  return [...PLAN_DOCUMENT_DIR_SEGMENTS, segments[segments.length - 1]].join("/");
}

/** 认出一个文件名的标题：`.pi/plans/2026-10-02-login-flow.md` → `login flow`。 */
export function planDocumentTitleFromFileName(fileName: string): string | undefined {
  const match = /^\d{4}-\d{2}-\d{2}-(.+)\.md$/i.exec(fileName);
  return match?.[1]?.replace(/-/g, " ");
}

export function isPlanToolName(value: unknown): value is PlanToolName {
  return typeof value === "string" && (PLAN_TOOL_NAMES as readonly string[]).includes(value);
}

export function isPlanToolDetails(value: unknown): value is PlanToolDetails {
  if (!value || typeof value !== "object") return false;
  const details = value as Partial<PlanToolDetails>;
  return details.kind === PLAN_TOOL_DETAILS_KIND
    && isPlanToolName(details.tool)
    && typeof details.filePath === "string"
    && typeof details.fileName === "string"
    && typeof details.relativePath === "string";
}

function referenceFromFilePath(filePath: string, title?: string, updatedAt?: string): PlanDocumentReference {
  const segments = toSlashes(filePath).split("/").filter((segment) => segment.length > 0);
  const fileName = segments[segments.length - 1] ?? "";
  return {
    filePath,
    fileName,
    relativePath: planDocumentRelativePath(filePath) ?? fileName,
    ...(title ? { title } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    absolute: looksAbsolute(filePath),
  };
}

/**
 * 从消息正文里认出计划文件（agent 或用户提到「见 `.pi/plans/xxx.md`」就能点开）。
 *
 * 边界扫描用 `indexOf` + 手工往两边走，**不用 lookbehind**（Safari 16.2 解析不了，
 * 一个正则字面量挂掉就是整个 chunk 白屏，见 AGENTS.md §旧 Safari / iOS 16.2）。
 * 相对路径必须给 `cwd` 才解析得出来；解析不出来就当没提过，不猜。
 */
export function findPlanDocumentReferences(
  text: string,
  options: { cwd?: string } = {},
): PlanDocumentReference[] {
  if (typeof text !== "string" || !text) return [];
  const markers = [".pi/plans/", ".pi\\plans\\"];
  const found: PlanDocumentReference[] = [];
  const seen = new Set<string>();
  let cursor = 0;

  const isPathChar = (character: string): boolean => /[A-Za-z0-9._~+%@/\\:-]/.test(character);

  while (cursor < text.length && found.length < PLAN_DOCUMENT_MAX_REFERENCES) {
    let markerIndex = -1;
    let markerLength = 0;
    for (const marker of markers) {
      const index = text.indexOf(marker, cursor);
      if (index !== -1 && (markerIndex === -1 || index < markerIndex)) {
        markerIndex = index;
        markerLength = marker.length;
      }
    }
    if (markerIndex === -1) break;

    let start = markerIndex;
    while (start > 0 && isPathChar(text[start - 1])) start -= 1;
    let end = markerIndex + markerLength;
    while (end < text.length && isPathChar(text[end])) end += 1;
    while (end > start && /[.\-_~:\\/]/.test(text[end - 1])) end -= 1;
    cursor = Math.max(end, markerIndex + markerLength);

    const written = text.slice(start, end);
    // URL 里也会出现同样的片段（`https://example.com/.pi/plans/a.md`）：那是链接，不是本机文件，
    // 渲染成「计划文档」卡片只会点出一个 403。链接由 Markdown 自己的锚点处理。
    if (!written || written.includes("://")) continue;
    const absolute = looksAbsolute(written);
    // 相对路径只在有 cwd 时才认：没有 cwd 我们无法知道它指的是哪棵树的 `.pi/plans`，
    // 猜一个就是给点击动作一个打不开的路径。
    const resolved = absolute ? written : (options.cwd ? joinPath(options.cwd, toSlashes(written)) : "");
    if (!resolved || !isPlanDocumentPath(resolved)) continue;
    const key = toSlashes(resolved).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(referenceFromFilePath(resolved, planDocumentTitleFromFileName(toSlashes(resolved).split("/").pop() ?? "")));
  }

  return found;
}

/**
 * 本会话在转录里认下过哪些计划文档（最新在前）。
 *
 * 与 `lib/todo-state.ts:extractTodoState` 同一套做法：状态从**当前分支**的 tool result 里读，
 * 所以分支切换与 fork 会连计划清单一起回退。UI 用它渲染「这个会话的计划」。
 */
export function extractPlanDocuments(entries: readonly unknown[]): PlanDocumentReference[] {
  const byPath = new Map<string, PlanDocumentReference>();
  for (const entry of entries) {
    const message = (entry && typeof entry === "object" && "message" in entry)
      ? (entry as { message?: unknown }).message
      : entry;
    if (!message || typeof message !== "object") continue;
    const candidate = message as { role?: unknown; toolName?: unknown; details?: unknown };
    if (candidate.role !== "toolResult" || !isPlanToolName(candidate.toolName)) continue;
    const details = candidate.details;
    if (!isPlanToolDetails(details) || details.error) continue;
    if (details.tool !== "write_plan") continue;
    byPath.set(toSlashes(details.filePath).toLowerCase(), {
      filePath: details.filePath,
      fileName: details.fileName,
      relativePath: details.relativePath,
      ...(details.title ? { title: details.title } : {}),
      bytes: details.bytes,
      updatedAt: details.updatedAt,
      absolute: true,
    });
  }
  return [...byPath.values()].sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
}

/** 最近的写计划工具结果就是「本会话当前那份」。 */
export function currentPlanDocument(entries: readonly unknown[]): PlanDocumentReference | null {
  return extractPlanDocuments(entries)[0] ?? null;
}

/**
 * 计划模式下**允许**的那一次动作（给 `lib/plan-mode.ts` 的放行判据用，见 NOTES §2.1）。
 *
 * 语义与 Proma 的 `agent-plan-file-policy.ts` 同款：计划档只允许在**本会话计划目录里**
 * 写/读 Markdown，不放开别的任何东西。三个条件缺一不可：
 *
 * 1. 工具名是本模块注册的那两个（不认识别的工具）；
 * 2. 显式 path 必须在 `planDirectory` 里（不给 `planDirectory` 一律 false，fail closed）；
 * 3. 路径里没有 `..`（`hasParentDirectorySegment` 在服务端还会再拒一次，这里是纯逻辑的提前拒绝）。
 */
export function isPlanArtifactToolCall(
  toolName: string,
  input: Record<string, unknown> | undefined,
  planDirectory: string | undefined,
): boolean {
  if (!isPlanToolName(toolName)) return false;
  if (!planDirectory) return false;
  const writtenPath = input?.path;
  if (writtenPath === undefined) return toolName === "read_plan"; // read_plan 不带 path = 读本会话当前那份
  if (typeof writtenPath !== "string" || !writtenPath) return false;
  const candidate = toSlashes(writtenPath);
  const directory = toSlashes(trimTrailingSeparators(planDirectory));
  // Windows 上大小写不敏感，两边都要折；POSIX 上原样比。
  const fold = WINDOWS_ABSOLUTE_RE.test(writtenPath) || writtenPath.startsWith("\\\\")
    ? (value: string) => value.toLowerCase()
    : (value: string) => value;
  const comparable = fold(candidate);
  const comparableDirectory = directory.endsWith("/") ? fold(directory) : `${fold(directory)}/`;
  if (!comparable.startsWith(comparableDirectory)) return false;
  const relative = comparable.slice(comparableDirectory.length);
  if (!relative || relative.includes("/")) return false; // 只允许计划目录**里**的文件，不许再穿一层
  return isPlanDocumentPath(writtenPath);
}