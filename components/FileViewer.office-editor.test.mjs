// fork:office-editor —— 结构守卫：把 GenOffice 编辑器接进 FileViewer 的几处接线钉住。
//
// 真实运行时验证在本地用一份临时静态宿主做过（编辑器启动、打开 fixture、saveDocx
// 打到 upload 端点）；这里只锁「接线还在」，因为这几处分散在 4 个文件里，任何一处
// 被回退都不会让编译或其它单测变红。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fileViewer = await readFile(new URL("./FileViewer.tsx", import.meta.url), "utf8");
const hostJs = await readFile(new URL("../public/office/host.js", import.meta.url), "utf8");
const hostHtml = await readFile(new URL("../public/office/host.html", import.meta.url), "utf8");
const filesRoute = await readFile(new URL("../app/api/files/[...path]/route.ts", import.meta.url), "utf8");
const nextConfig = await readFile(new URL("../next.config.mjs", import.meta.url), "utf8");

function documentViewerBlock() {
  const start = fileViewer.indexOf("function DocumentViewer(");
  const end = fileViewer.indexOf("export function FileViewer(", start);
  assert.notEqual(start, -1, "DocumentViewer not found");
  assert.notEqual(end, -1, "FileViewer not found after DocumentViewer");
  return fileViewer.slice(start, end);
}

test("DocumentViewer can switch the docx preview into the office editor iframe", () => {
  const block = documentViewerBlock();
  assert.match(block, /const canEdit = ext === "docx"/);
  assert.match(block, /\/office\/host\.html\?\$\{search\.toString\(\)\}/);
  assert.match(block, /mode === "edit" \? \(/);
  assert.match(block, /pi-office:flush/);
  // 编辑态必须停掉预览的 watch（否则外部改动会把 iframe 重载、丢掉未保存内容）。
  assert.match(block, /if \(!watchEnabled \|\| mode === "edit"\) return;/);
});

test("office host page is a same-origin shell over public/office assets", () => {
  assert.match(hostHtml, /id="root"/);
  assert.match(hostHtml, /\.\/host\.js/);
  assert.match(hostHtml, /\.\/assets\/index-[^"]+\.js|\.\/assets\/index-[^"]+\.css/);
  assert.match(hostJs, /window\.desktop = desktop/);
  assert.match(hostJs, /consumePendingOpenDocx/);
  assert.match(hostJs, /type=upload&conflict=overwrite/);
  assert.match(hostJs, /type=download/);
});

test("office host rejects saving when the file changed on disk", () => {
  assert.match(hostJs, /reason: "external-modified"/);
  assert.match(filesRoute, /mtimeMs: stat\.mtimeMs/);
});

test("next.config rewrites the absolute /assets/* references back to office assets", () => {
  assert.match(nextConfig, /source: "\/assets\/:path\*", destination: "\/office\/assets\/:path\*"/);
});
