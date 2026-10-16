/**
 * Fix the exported trace page's three recursive tree walks.
 *
 * The page pi's own `/export` produces builds a session tree and then walks it three
 * times with functions that call themselves for each child:
 *
 *   - `sortChildren` — sorts every node's children by timestamp.
 *   - `mapNodes` — indexes the tree by entry id, the first time a node is clicked.
 *   - `markActive` — marks the nodes on the active path while flattening the tree.
 *
 * A conversation is usually a **chain, not a tree** — one message after another, no
 * branches — which is exactly the shape that makes these recursion depth rather than
 * width. A 5000-entry chain is 5000 stack frames, and the page dies with
 * `RangeError: Maximum call stack size exceeded` before it draws anything: a blank
 * trace, for no visible reason, on nothing but the longest chats.
 *
 * They are replaced with the iterative equivalents — same order, same result — by
 * string substitution, because the functions are inlined into the exported HTML at
 * export time. `template.js` lives in `node_modules` and would be overwritten by the
 * next install, so patching the output is the only place this can go.
 *
 * **A pattern that no longer matches is reported, not thrown.** The SDK may reword one
 * of these; when it does, the trace should still open and be readable for every ordinary
 * conversation rather than fail outright because a robustness patch went stale.
 * `test/trace-export-patch.test.ts` pins the three patterns against the installed
 * template, so the drift is seen in the test run instead of on somebody's long chat.
 *
 * Nothing here logs: the patterns are data and the result names what was missed, so the
 * caller decides what to do about it. That also keeps this module loadable by `node --test`,
 * which cannot import `./logger` (it pulls in Electron).
 */

/** One substitution, with the text it expects to find exactly once. */
type Patch = { name: string; search: string; replacement: string };

const PATCHES: Patch[] = [
  {
    name: "sortChildren",
    search: `        function sortChildren(node) {
          node.children.sort((a, b) =>
            new Date(a.entry.timestamp).getTime() - new Date(b.entry.timestamp).getTime()
          );
          node.children.forEach(sortChildren);
        }`,
    // Pre-order DFS, children pushed in reverse so they pop in their original order.
    replacement: `        function sortChildren(root) {
          const stack = [root];
          while (stack.length) {
            const node = stack.pop();
            node.children.sort((a, b) =>
              new Date(a.entry.timestamp).getTime() - new Date(b.entry.timestamp).getTime()
            );
            for (let i = node.children.length - 1; i >= 0; i--) {
              stack.push(node.children[i]);
            }
          }
        }`,
  },
  {
    name: "mapNodes",
    search: `          function mapNodes(node) {
            treeNodeMap.set(node.entry.id, node);
            node.children.forEach(mapNodes);
          }
          tree.forEach(mapNodes);`,
    replacement: `          const stack = [...tree].reverse();
          while (stack.length) {
            const node = stack.pop();
            treeNodeMap.set(node.entry.id, node);
            for (let i = node.children.length - 1; i >= 0; i--) {
              stack.push(node.children[i]);
            }
          }`,
  },
  {
    name: "markActive",
    search: `        function markActive(node) {
          let has = activePathIds.has(node.entry.id);
          for (const child of node.children) {
            if (markActive(child)) has = true;
          }
          containsActive.set(node, has);
          return has;
        }`,
    // Two stacks: the first walks the subtree, the second settles it children-first, so a
    // parent is written only after every child it depends on has been.
    replacement: `        function markActive(root) {
          const stack1 = [root];
          const stack2 = [];
          while (stack1.length) {
            const node = stack1.pop();
            stack2.push(node);
            for (const child of node.children) {
              stack1.push(child);
            }
          }
          while (stack2.length) {
            const node = stack2.pop();
            let has = activePathIds.has(node.entry.id);
            for (const child of node.children) {
              if (containsActive.get(child)) has = true;
            }
            containsActive.set(node, has);
          }
        }`,
  },
];

export type TracePatchResult = {
  html: string;
  /** Names of the walks that could not be replaced, for the caller to report. */
  missed: string[];
};

/**
 * The exported page with its tree walks made iterative.
 *
 * When any pattern is missing the original text is handed back untouched: a partly patched
 * page is the one outcome worth ruling out, because the walks share a tree and a page where
 * one of them recurses while another does not is neither the old document nor the new one.
 */
export function patchTraceHtml(html: string): TracePatchResult {
  // `template.js` writes LF, but the text can arrive with CRLF (an export produced on
  // Windows, or read back through a path that normalises). Normalise, match, and hand back
  // LF: an HTML page's line endings are its own business and every browser reads both.
  const normalized = html.replace(/\r\n/g, "\n");
  let out = normalized;
  const missed: string[] = [];

  for (const { name, search, replacement } of PATCHES) {
    const occurrences = out.split(search).length - 1;
    if (occurrences === 1) {
      out = out.replace(search, replacement);
      continue;
    }
    // Zero means the SDK reworded it. More than one would mean a replacement that rewrote
    // only the first occurrence of a repeated walk, which is worse than not patching.
    missed.push(`${name}×${occurrences}`);
  }

  return missed.length === 0 ? { html: out, missed } : { html: normalized, missed };
}

/**
 * The exact text each substitution looks for, and what it becomes.
 *
 * Exported so `test/trace-export-patch.test.ts` can hold them against the SDK's own
 * `template.js`: a reworded walk then fails in the test run rather than on somebody's
 * 5000-message chat.
 */
export function tracePatchPatterns(): ReadonlyArray<{ name: string; search: string; replacement: string }> {
  return PATCHES;
}
