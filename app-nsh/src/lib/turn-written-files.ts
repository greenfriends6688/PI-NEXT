import type { AssistantContentBlock, ToolResultMessage } from "./types";
import { resolveLocalFilePath } from "./file-links";
import { isApplyPatchToolName, isEditToolName, isWriteToolName } from "./tool-names";
import {
  applyPatchPreviewToFiles,
  applyPatchResultHasFailures,
  getApplyPatchAppliedFiles,
  getApplyPatchInputText,
  parseApplyPatchInput,
} from "./apply-patch";
import { parseUnifiedPatch, type SplitDiffFile } from "./patch";

export interface WrittenFile {
  /** Resolved absolute path of a file this turn wrote. */
  filePath: string;
  /** Lines this turn added to the file, when the tool result carried a diff. */
  additions?: number;
  /** Lines this turn removed from the file, when the tool result carried a diff. */
  deletions?: number;
}

function isFileWritingToolName(toolName: string): boolean {
  return isWriteToolName(toolName) || isEditToolName(toolName);
}

function readToolPath(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  const value = input.file_path ?? input.path;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function writtenPathsFromFiles(files: SplitDiffFile[] | null): string[] {
  if (!files) return [];
  // Deletes have no newPath — they are not files this turn wrote.
  return files
    .map((file) => file.newPath)
    .filter((filePath): filePath is string => typeof filePath === "string" && filePath.length > 0);
}

function collectApplyPatchDeletePaths(input: Record<string, unknown> | undefined, details: unknown): Set<string> {
  const deleted = new Set<string>();
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const preview = (details as Record<string, unknown>).preview;
    if (preview && typeof preview === "object" && !Array.isArray(preview)) {
      const files = (preview as Record<string, unknown>).files;
      if (Array.isArray(files)) {
        for (const raw of files) {
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
          const entry = raw as { operation?: unknown; filePath?: unknown };
          if (entry.operation === "delete" && typeof entry.filePath === "string" && entry.filePath.length > 0) {
            deleted.add(entry.filePath);
          }
        }
      }
    }
  }
  for (const match of getApplyPatchInputText(input).matchAll(/^\*\*\* Delete File: (.+)$/gm)) {
    const filePath = (match[1] ?? "").trim();
    if (filePath) deleted.add(filePath);
  }
  return deleted;
}

/**
 * Collect the paths one apply_patch call actually wrote.
 *
 * Prefers `details.result.appliedFiles` (what landed, including rename
 * targets). Falls back to the applied-result preview, then the patch
 * document. Deletes are omitted — they are not files this turn wrote.
 * A returned failure with no `appliedFiles` writes nothing.
 */
function readApplyPatchPaths(input: Record<string, unknown> | undefined, result: ToolResultMessage | undefined): string[] {
  const details = result?.details;
  const deleted = collectApplyPatchDeletePaths(input, details);
  const applied = getApplyPatchAppliedFiles(details);
  if (applied) return applied.filter((filePath) => !deleted.has(filePath));
  if (applyPatchResultHasFailures(details)) return [];

  if (details && typeof details === "object" && !Array.isArray(details)) {
    const fromPreview = writtenPathsFromFiles(applyPatchPreviewToFiles((details as Record<string, unknown>).preview));
    if (fromPreview.length > 0) return fromPreview;
  }
  return writtenPathsFromFiles(parseApplyPatchInput(getApplyPatchInputText(input)));
}


/**
 * Per-file `+N −M` for one tool call, when its result carried a diff.
 *
 * Two shapes are read, in the same order the diff view uses: an apply_patch
 * result's `details.preview` (per-file applied diffs) and, for the built-in
 * edit/write tools, a unified diff string under `details.diff` / `details.patch`.
 * A result without a diff simply yields no stats — the card then shows the
 * file count alone rather than inventing numbers.
 */
function diffStatsFor(
  toolName: string,
  input: Record<string, unknown> | undefined,
  result: ToolResultMessage | undefined,
): Map<string, { additions: number; deletions: number }> {
  const details = result?.details;
  let files: SplitDiffFile[] | null = null;

  if (isApplyPatchToolName(toolName)) {
    const preview = details && typeof details === "object" && !Array.isArray(details)
      ? (details as Record<string, unknown>).preview
      : undefined;
    files = applyPatchPreviewToFiles(preview) ?? parseApplyPatchInput(getApplyPatchInputText(input));
  } else if (details && typeof details === "object" && !Array.isArray(details)) {
    const record = details as Record<string, unknown>;
    const diffText = [record.diff, record.patch, record.unifiedDiff].find(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    if (diffText) files = parseUnifiedPatch(diffText);
  }

  const stats = new Map<string, { additions: number; deletions: number }>();
  for (const file of files ?? []) {
    const raw = file.newPath ?? file.oldPath;
    if (!raw) continue;
    /* 统一 diff 的头是 `a/x` / `b/x`；去掉这一层，才能和工具入参里的路径对上。 */
    const path = raw.replace(/^[ab]\//, "");
    let additions = 0;
    let deletions = 0;
    for (const row of file.rows) {
      if (row.type !== "line") continue;
      if (row.right.type === "added") additions += 1;
      if (row.left.type === "removed") deletions += 1;
    }
    stats.set(path, { additions, deletions });
  }
  return stats;
}


/** diff 头里的相对路径和工具入参的绝对路径对不上时，按路径尾部认领。 */
function pickStats(
  stats: Map<string, { additions: number; deletions: number }>,
  rawPath: string,
  filePath: string,
): { additions: number; deletions: number } | undefined {
  const direct = stats.get(rawPath) ?? stats.get(filePath) ?? stats.get(rawPath.replace(/^[ab]\//, ""));
  if (direct) return direct;
  for (const [key, value] of stats) {
    if (filePath === key || filePath.endsWith("/" + key) || key.endsWith("/" + filePath)) return value;
  }
  return undefined;
}

/**
 * Collect the distinct files a single assistant turn actually wrote.
 *
 * Every entry is derived from a `write`/`edit`/`apply_patch` tool call whose
 * result arrived and did not error — never from the reply text. A path the
 * assistant merely mentions in prose is not evidence that any file was
 * touched, so it is not a source here; the tool call is the record of what
 * happened.
 *
 * Paths are resolved against `cwd`, deduped, and kept in first-seen order.
 */
export function extractTurnWrittenFiles(
  content: AssistantContentBlock[],
  toolResults: Map<string, ToolResultMessage> | undefined,
  cwd?: string,
): WrittenFile[] {
  const seen = new Set<string>();
  const writtenFiles: WrittenFile[] = [];

  for (const block of content) {
    if (block.type !== "toolCall") continue;
    if (!isFileWritingToolName(block.toolName) && !isApplyPatchToolName(block.toolName)) continue;

    const result = toolResults?.get(block.toolCallId);
    if (!result || result.isError) continue;

    const rawPaths = isApplyPatchToolName(block.toolName)
      ? readApplyPatchPaths(block.input, result)
      : [readToolPath(block.input)];
    const stats = diffStatsFor(block.toolName, block.input, result);

    for (const rawPath of rawPaths) {
      if (!rawPath) continue;

      // Tool arguments are filesystem paths, not hrefs: preserve characters such
      // as #, ?, and :digits that have special meaning in links and source refs.
      const filePath = resolveLocalFilePath(rawPath, cwd);
      if (!filePath) continue;

      if (seen.has(filePath)) continue;
      seen.add(filePath);
      const hit = pickStats(stats, rawPath, filePath);
      writtenFiles.push(hit ? { filePath, ...hit } : { filePath });
    }
  }

  return writtenFiles;
}
