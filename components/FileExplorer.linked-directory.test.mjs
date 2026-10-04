import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

// fork:linked-directory — 文件树里「通向项目之外的符号链接」那一块（#748）。
// renderToStaticMarkup 不跑 effect，所以放行后的重取不用 mock fetch。
const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { TreeNode } = await jiti.import("./FileExplorer.tsx");
const { enLocale } = await jiti.import("@/lib/i18n/messages/en.ts");
const { translateMessage } = await jiti.import("@/lib/i18n/format.ts");

const source = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");
const t = (key, params) => translateMessage("en", key, { en: enLocale.messages }, params);

function renderNode(node, { open = true } = {}) {
  return renderToStaticMarkup(React.createElement(TreeNode, {
    node,
    depth: 0,
    cwd: "/hub",
    onOpenFile() {},
    onAtMention() {},
    expandedPaths: new Set(open ? [node.fullPath] : []),
    onToggleExpanded() {},
    highlightedPaths: new Set(),
    gitStatusByPath: new Map(),
    changedDirectoryPaths: new Set(),
    renaming: null,
    onRenameValueChange() {},
    onRenameSubmit() {},
    onRenameCancel() {},
    creating: null,
    onCreateValueChange() {},
    onCreateSubmit() {},
    onCreateCancel() {},
    t,
  }));
}

const linkedNode = {
  name: "linked",
  fullPath: "/hub/linked",
  isDir: true,
  size: 0,
  children: [],
  loaded: false,
  outsideLinkTarget: "/elsewhere/project",
};

test("展开一条待放行的链接：说清目标并给出放行按钮", () => {
  const html = renderNode(linkedNode);
  assert.match(html, /Links to \/elsewhere\/project, outside this project/);
  assert.match(html, /<button[^>]*class="d-btn sm primary"[^>]*title="Browse \/elsewhere\/project until Pi Web restarts[^"]*"[^>]*>Allow browsing<\/button>/);
  // 待放行时绝不列子项（服务端只会 403）。
  assert.doesNotMatch(html, />empty</);
});

test("收起来的链接在行上带标记，但不弹面板", () => {
  const html = renderNode(linkedNode, { open: false });
  assert.match(html, /aria-label="Links to \/elsewhere\/project, outside this project"/);
  assert.doesNotMatch(html, /Allow browsing/);
});

test("普通目录不出现任何链接提示", () => {
  const html = renderNode({ ...linkedNode, outsideLinkTarget: undefined, loaded: true });
  assert.doesNotMatch(html, /outside this project|Allow browsing/);
  assert.match(html, />\(empty\)</);
});

test("展开失败把原因显示出来，而不是留一个空文件夹", () => {
  // 只看 TreeNode 的 loadChildren，别把别的 catch（响应体解析、上传）也算进来。
  const start = source.indexOf("const loadChildren = useCallback");
  const end = source.indexOf("}, [loaded, node.fullPath]);", start);
  assert.ok(start > 0 && end > start, "loadChildren block not found");
  const block = source.slice(start, end);
  assert.doesNotMatch(block, /catch \{\s*\/\/ ignore\s*\}/);
  assert.match(block, /setLoadError\(error instanceof Error \? error\.message : String\(error\)\)/);
  assert.match(source, /\{node\.isDir && open && !pendingLinkTarget && loadError && \(/);
  assert.match(source, /role="alert"/);
});

test("放行时发的是操作员当时看到的那个目标", () => {
  assert.match(source, /\?type=allow-link`, \{\s*method: "POST",\s*headers: \{ "Content-Type": "application\/json" \},\s*body: JSON\.stringify\(\{ target \}\)/);
  assert.match(source, /await allowOutsideLink\(node\.fullPath, pendingLinkTarget\);/);
  // 待放行的链接不会被去列。
  assert.match(source, /if \(next && !loaded && !pendingLinkTarget\) loadChildren\(\);/);
});

test("包住项目或主目录的链接：先警告再确认", () => {
  const html = renderNode({ ...linkedNode, outsideLinkEncloses: true });
  assert.match(html, /That folder also contains this project or your home folder\./);
  assert.doesNotMatch(renderNode(linkedNode), /contains this project/);
  assert.match(source, /node\.outsideLinkEncloses\s*\n?\s*&& !window\.confirm\(t\("files\.allowEnclosingLinkConfirm"/);
});

test("复用画板的权限卡骨架，不再新增 pw-* 类", () => {
  for (const className of ["d-perm", "d-perm-body"]) {
    assert.match(source, new RegExp(`className="${className}"`), className);
  }
  assert.match(source, /className="d-btn sm primary"/);
  assert.doesNotMatch(source, /className="pw-/);
});