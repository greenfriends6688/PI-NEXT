/**
 * Tool-name predicates shared by the chat views.
 *
 * Pi's built-in names are plain `write` / `edit`, but MCP servers expose the
 * same operations under prefixed or namespaced names, so each predicate also
 * accepts the common decorated forms.
 */

export function isWriteToolName(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return name === "write" ||
    name.startsWith("write_") ||
    name.endsWith(".write") ||
    name.endsWith("_write");
}

export function isEditToolName(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return name === "edit" ||
    name.startsWith("edit_") ||
    name.endsWith(".edit") ||
    name.endsWith("_edit") ||
    name.includes("str_replace") ||
    name.includes("replace_editor");
}

/** Codex-style patch tools (e.g. the pi-apply-patch extension). */
export function isApplyPatchToolName(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return name === "apply_patch" ||
    name.startsWith("apply_patch_") ||
    name.endsWith(".apply_patch") ||
    name.endsWith("_apply_patch");
}

/**
 * fork:think-variants（2026-10-06）—— 联网 / 浏览器类工具。
 *
 * 画板 D-27 帧 C 的思考指示器第四档是「正在搜索 · infinity（彗星绕八字）」，
 * 而 step-categorizer 的 tone 表里没有「联网」这一类（网页抓取会落进
 * document_search 或 command_execution）。这一条只按**工具名**判，专供那一档。
 */
export function isWebToolName(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return name.includes("browser") ||
    name.includes("webfetch") ||
    name.includes("web_fetch") ||
    name.includes("websearch") ||
    name.includes("web_search") ||
    name.includes("fetch_url") ||
    name.includes("http_request") ||
    name === "fetch";
}
