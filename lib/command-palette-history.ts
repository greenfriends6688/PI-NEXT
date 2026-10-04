/**
 * lib/command-palette-history.ts — fork:command-palette
 *
 * 命令面板的搜索历史。抄 ZCode 的那一处真优点（`command-center/commandCenterSearchHistory.ts`：
 * localStorage、按 workspace 分桶、上限 20、大小写去重、MRU 置首）。
 *
 * 只抄这一件，**不抄**它的排序：ZCode 把 cmdk 的 `shouldFilter` 关了
 * （`CommandCenterDialog.tsx:988`），三段匹配全是布尔 AND-子串
 * （`:99-116` 命令与文件、host 侧会话是 SQL `LIKE`），所以「面板里的文件搜索」
 * 反而比本仓文件树那条真评分的路（`lib/file-fuzzy.ts` 的 `scoreEntry`）弱。
 * 面板这边直接复用 `lib/file-fuzzy.ts`，不重写一套。
 *
 * 纯逻辑 + localStorage 注入，便于单测。
 */

export const COMMAND_PALETTE_HISTORY_LIMIT = 20;

export type CommandPaletteScope = "all" | "commands" | "sessions" | "files";

export interface CommandPaletteHistoryEntry {
  query: string;
  scope: CommandPaletteScope;
  updatedAt: number;
}

/** 只有前缀字符的查询（`>` / `#` / `@`）不记 —— 那是切域，不是搜索。 */
export function isMeaningfulPaletteQuery(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  const bare = /^([>#@])+$/u.test(trimmed);
  const barePrefix = /^([>#@])(\s*)$/u.test(trimmed);
  return !bare && !barePrefix;
}

export function readCommandPaletteHistory(
  storage: Pick<Storage, "getItem">,
  bucket: string,
): CommandPaletteHistoryEntry[] {
  try {
    const raw = storage.getItem(keyFor(bucket));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isHistoryEntry)
      .slice(0, COMMAND_PALETTE_HISTORY_LIMIT);
  } catch {
    // 坏 JSON / 配额满 / 隐私模式禁写 —— 都不该让面板打不开。
    return [];
  }
}

/**
 * 置入一条：空查询不记、大小写去重、MRU 置首、封顶。
 * 纯函数（返回新数组），写盘交给调用方。
 */
export function pushCommandPaletteHistory(
  entries: readonly CommandPaletteHistoryEntry[],
  entry: CommandPaletteHistoryEntry,
): CommandPaletteHistoryEntry[] {
  if (!isMeaningfulPaletteQuery(entry.query)) return [...entries].slice(0, COMMAND_PALETTE_HISTORY_LIMIT);
  const needle = entry.query.trim().toLowerCase();
  const rest = entries.filter((item) => item.query.trim().toLowerCase() !== needle);
  return [{ ...entry, query: entry.query.trim(), updatedAt: entry.updatedAt }, ...rest]
    .slice(0, COMMAND_PALETTE_HISTORY_LIMIT);
}

export function writeCommandPaletteHistory(
  storage: Pick<Storage, "setItem">,
  bucket: string,
  entries: readonly CommandPaletteHistoryEntry[],
): void {
  try {
    storage.setItem(keyFor(bucket), JSON.stringify(entries.slice(0, COMMAND_PALETTE_HISTORY_LIMIT)));
  } catch {
    // 写不进去就算了：历史是锦上添花，不值得因此报错。
  }
}

function keyFor(bucket: string): string {
  return `pi-web:command-palette-history:${bucket}`;
}

function isHistoryEntry(value: unknown): value is CommandPaletteHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.query === "string"
    && typeof record.updatedAt === "number"
    && (record.scope === "all" || record.scope === "commands" || record.scope === "sessions" || record.scope === "files");
}

/**
 * 域前缀：`>` 命令 / `#` 会话 / `@` 文件，无前缀则全域。
 * 前缀**粘性**：判域只看前缀，删掉前缀才回到手动选中的域
 * （对齐 ZCode 的 `resolveQueryScope` + `activeScope`，`CommandCenterDialog.tsx:162-180` / `:445-447`）。
 */
export function resolvePaletteScope(raw: string): { scope: CommandPaletteScope; explicit: boolean; query: string } {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith(">")) return { scope: "commands", explicit: true, query: trimmed.slice(1).trimStart() };
  if (trimmed.startsWith("#")) return { scope: "sessions", explicit: true, query: trimmed.slice(1).trimStart() };
  if (trimmed.startsWith("@")) return { scope: "files", explicit: true, query: trimmed.slice(1).trimStart() };
  return { scope: "all", explicit: false, query: raw };
}

export const PALETTE_SCOPE_PREFIXES: Array<{ scope: CommandPaletteScope; prefix: string }> = [
  { scope: "all", prefix: "" },
  { scope: "commands", prefix: ">" },
  { scope: "sessions", prefix: "#" },
  { scope: "files", prefix: "@" },
];