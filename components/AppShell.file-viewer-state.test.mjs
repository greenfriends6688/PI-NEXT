import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

function fileContentBlock() {
  // fork:pr40-split (2026-10-03) —— 文件 tab 的渲染搬进了 `renderTabContent(tabId,
  // resident)`，它同时服务两条路径：单列（`resident=true`，激活过的都常驻、切走只
  // hidden）与分屏（`resident=false`，**每格只挂自己那一个 tab**）。所以切片从那个
  // 函数的定义起，而不是从 `{/* Body: … */}` 注释起。
  // 下界不变：工作区壳之后的第一个浮层（设置面板挂载点）。
  const start = source.indexOf("const renderTabContent = (tabId: string, resident: boolean) => {");
  const end = source.indexOf("\n    {settingsSection && (");
  assert.notEqual(start, -1, "renderTabContent not found");
  assert.notEqual(end, -1, "end of file content block not found");
  return source.slice(start, end);
}

test("every mounted file tab keeps its own FileViewer instance", () => {
  const block = fileContentBlock();
  // fork:file-tab-keep-alive — 从「只挂载激活的那个」改成「激活过的都常驻、切走只
  // hidden」：滚动位置/搜索/未保存的编辑态都靠这一点保住。
  // fork:pr40-split — 挂载门槛现在挂在 `resident` 分支上：分屏时这一格**就是**它的
  // 内容，没有「先激活再挂」这一步，所以不能拿 mountedFileTabs 去卡它。
  assert.match(block, /if \(resident && !mountedFileTabs\.has\(fileTab\.id\)\) return null;/);
  // 全文件仍然只有一个 FileViewer 挂载点 —— 单列与分屏共用它。
  assert.equal(source.match(/<FileViewer/g)?.length, 1);
  assert.match(block, /hidden=\{!isActive\}/);
  // 关闭后必须真的卸载：剪枝 effect 把不在 fileTabs 里的 id 从集合里去掉。
  assert.match(source, /const next = new Set\(\[\.\.\.current\]\.filter\(\(id\) => open\.has\(id\)\)\)/);
});

test("each viewer restores its own tab state and saves it with a revision", () => {
  const block = fileContentBlock();
  assert.match(block, /key=\{`\$\{fileTab\.id\}:\$\{fileTab\.viewerRevision \?\? 0\}`\}/);
  assert.match(block, /initialState=\{fileTab\.viewerState\}/);
  assert.match(block, /handleFileViewerStateChange\(\s*fileTab\.id,\s*fileTab\.viewerRevision \?\? 0,/);
});

test("the editor stays active when it occupies the main region", () => {
  assert.match(source, /const editorVisible = workspaceSwapped \|\| rightPanelOpen;/);
  // 隐藏的 tab 不再看文件变更，也不参与选区提及：只有激活项才吃 editorVisible。
  assert.match(fileContentBlock(), /watchEnabled=\{editorVisible && isActive\}/);
  assert.match(fileContentBlock(), /onMentionLines=\{editorVisible && isActive \? handleFileLineMention : undefined\}/);
});
