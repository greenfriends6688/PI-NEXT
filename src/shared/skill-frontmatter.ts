/**
 * One line of a skill's frontmatter, edited without touching the rest of the file.
 *
 * `disable-model-invocation: true` is how pi is told not to put a skill in front of the model
 * while leaving it available to a person (and to `/skill` invocations). It is the difference
 * between 「别让它每轮都读这个」 and deleting the skill, and a skill is somebody's own markdown:
 * it may have a long hand-written description, comments, keys this app has never heard of,
 * and text that re-wraps into something else when a YAML library round-trips it.
 *
 * So this is a line edit, not a parse: find the key inside the frontmatter block, replace its
 * value or add the line, and leave every other byte where it is — line endings included.
 * A file with **no** frontmatter gets one, because the alternative (writing `false` into a
 * skill to turn it off) would be a setting nobody could find again.
 */

const KEY = "disable-model-invocation";

/** The frontmatter block of a skill file, or null when it has none. */
function frontmatterRange(text: string): { start: number; end: number } | null {
  const normalized = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const offset = text.length - normalized.length;
  if (!/^---[ \t]*\r?\n/.test(normalized)) return null;
  const rest = normalized.slice(normalized.indexOf("\n") + 1);
  const close = /^---[ \t]*\r?$/m.exec(rest);
  if (!close) return null;
  const start = offset + normalized.indexOf("\n") + 1;
  return { start, end: start + close.index };
}

function findKey(text: string, range: { start: number; end: number }): { from: number; to: number; value: string } | null {
  const block = text.slice(range.start, range.end);
  const pattern = new RegExp(`^[ \\t]*${KEY}[ \\t]*:[ \\t]*(.*?)[ \\t]*\\r?$`, "m");
  const match = pattern.exec(block);
  if (!match) return null;
  return { from: range.start + match.index, to: range.start + match.index + match[0].length, value: match[1]! };
}

/** Whether the skill is switched off for the model. Absent, or anything but `true`, is on. */
export function readsDisabledForModel(text: string): boolean {
  const range = frontmatterRange(text);
  if (!range) return false;
  const found = findKey(text, range);
  return found ? /^true$/i.test(found.value.trim()) : false;
}

/**
 * Whether the file *starts* a frontmatter block without closing it.
 *
 * Such a file is not a skill pi will load, and editing it would either add a second block in
 * front of a broken one or silently leave it broken. The caller refuses the edit and says so.
 */
export function hasUnclosedFrontmatter(text: string): boolean {
  const normalized = text.startsWith("\uFEFF") ? text.slice(1) : text;
  if (!/^---[ \t]*\r?\n/.test(normalized)) return false;
  const rest = normalized.slice(normalized.indexOf("\n") + 1);
  return !/^---[ \t]*\r?$/m.test(rest);
}

/**
 * The same file with that one key set, or removed when it would be `false`.
 *
 * Removing rather than writing `false` keeps a file toggled off and on again byte-identical
 * to the one the author saved — which is the promise this whole module exists for. A removal
 * that empties the block takes the block with it, so switching a bare skill off and on again
 * does not leave two lines of scaffolding behind.
 *
 * Returns the text unchanged when there is nothing to do, or when the frontmatter is unclosed
 * (`hasUnclosedFrontmatter`) — the caller decides whether that is worth an error.
 *
 * The edit is line-based on purpose: rebuilding the block from a parsed object would re-wrap
 * a hand-wrapped description, drop a comment, and lose every key this app does not know.
 */
export function withDisabledForModel(text: string, disabled: boolean): string {
  if (hasUnclosedFrontmatter(text)) return text;
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const range = frontmatterRange(text);
  if (!range) {
    if (!disabled) return text;
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    return `${bom}---${eol}${KEY}: true${eol}---${eol}${eol}${text.slice(bom.length)}`;
  }
  const block = text.slice(range.start, range.end);
  const eol = block.includes("\r\n") ? "\r\n" : "\n";
  // The block's own lines, with the empty string that its trailing newline produces last.
  const lines = block.split(/\r?\n/);
  const pattern = new RegExp(`^[ \\t]*${KEY}[ \\t]*:`);
  const index = lines.findIndex((line) => pattern.test(line));
  if (!disabled && index === -1) return text;
  if (disabled && index === -1) lines.splice(lines.length - 1, 0, `${KEY}: true`);
  else if (disabled) lines[index] = `${KEY}: true`;
  else {
    lines.splice(index, 1);
    if (lines.every((line) => line.trim() === "")) {
      // Nothing but this key was in the block: the fences go with it, so the file looks like
      // an author's rather than like something an app has been editing.
      const after = text.slice(range.end).replace(/^---[ \t]*\r?\n(\r?\n)?/, "");
      return `${bom}${after}`;
    }
  }
  return `${text.slice(0, range.start)}${lines.join(eol)}${text.slice(range.end)}`;
}
