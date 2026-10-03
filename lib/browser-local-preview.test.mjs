import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { BrowserLocalPreviewDenied, BROWSER_PREVIEW_ROUTE, resolveBrowserLocalPreview } =
  await jiti.import("./browser-local-preview.ts");

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-web-preview-")));
  const project = join(root, "project");
  mkdirSync(join(project, "site"), { recursive: true });
  mkdirSync(join(root, "outside"), { recursive: true });
  writeFileSync(join(project, "report.html"), "<h1>ok</h1>");
  writeFileSync(join(project, "notes.md"), "# not html");
  writeFileSync(join(project, "site", "index.html"), "<h1>index</h1>");
  writeFileSync(join(root, "outside", "secret.html"), "<h1>secret</h1>");
  const roots = new Set([project]);
  // 注入文件系统能力而不是在模块里直接 import fs：保持这一层可单测，
  // 语义与 node:fs 一致（绝对路径不拼到 base 后面）。
  const fs = {
    resolvePath: (base, target) => (isAbsolute(target) ? target : join(base, target)),
    realPath: (target) => {
      try {
        return realpathSync(target);
      } catch {
        return target;
      }
    },
    exists: (target) => statSync(target, { throwIfNoEntry: false }) !== undefined,
    isDirectory: (target) => statSync(target, { throwIfNoEntry: false })?.isDirectory() === true,
    isFile: (target) => statSync(target, { throwIfNoEntry: false })?.isFile() === true,
  };
  return { root, project, roots, fs, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("已授权目录内的 HTML 变成站内相对地址（不含绝对路径）", () => {
  const f = fixture();
  try {
    const target = resolveBrowserLocalPreview("report.html", { roots: f.roots, baseDir: f.project, ...f.fs });
    assert.equal(target.fileName, "report.html");
    assert.ok(target.url.startsWith(`${BROWSER_PREVIEW_ROUTE}?path=`));
    assert.equal(target.url.includes(f.root), false, "绝对路径不该进 URL");
    assert.equal(decodeURIComponent(target.url.split("path=")[1]), join(f.project, "report.html"));
  } finally {
    f.cleanup();
  }
});

test("目录回落到 index.html", () => {
  const f = fixture();
  try {
    const target = resolveBrowserLocalPreview("site", { roots: f.roots, baseDir: f.project, ...f.fs });
    assert.equal(target.fileName, "index.html");
  } finally {
    f.cleanup();
  }
});

test("授权根之外一律拒 —— 这条就是「不许 file:// 之后的那个口子」", () => {
  const f = fixture();
  try {
    assert.throws(
      () => resolveBrowserLocalPreview(join(f.root, "outside", "secret.html"), { roots: f.roots, baseDir: f.project, ...f.fs }),
      (error) => error instanceof BrowserLocalPreviewDenied && error.reason === "outside-roots",
    );
  } finally {
    f.cleanup();
  }
});

test(".. 分段一律拒（link/.. 字典序上等于 root，实际是链接目标旁边那一格）", () => {
  const f = fixture();
  try {
    assert.throws(
      () => resolveBrowserLocalPreview("site/../notes.md", { roots: f.roots, baseDir: f.project, ...f.fs }),
      (error) => error instanceof BrowserLocalPreviewDenied && error.reason === "parent-segment",
    );
  } finally {
    f.cleanup();
  }
});

test("只放 HTML：其它扩展名与不存在的文件都拒", () => {
  const f = fixture();
  try {
    assert.throws(
      () => resolveBrowserLocalPreview("notes.md", { roots: f.roots, baseDir: f.project, ...f.fs }),
      (error) => error instanceof BrowserLocalPreviewDenied && error.reason === "not-html",
    );
    assert.throws(
      () => resolveBrowserLocalPreview("missing.html", { roots: f.roots, baseDir: f.project, ...f.fs }),
      (error) => error instanceof BrowserLocalPreviewDenied && error.reason === "not-found",
    );
    assert.throws(
      () => resolveBrowserLocalPreview("   ", { roots: f.roots, baseDir: f.project, ...f.fs }),
      (error) => error instanceof BrowserLocalPreviewDenied && error.reason === "empty",
    );
  } finally {
    f.cleanup();
  }
});

test("目录里没有 index.html 时给出可执行的拒绝原因", () => {
  const f = fixture();
  try {
    mkdirSync(join(f.project, "empty-dir"), { recursive: true });
    assert.throws(
      () => resolveBrowserLocalPreview("empty-dir", { roots: f.roots, baseDir: f.project, ...f.fs }),
      (error) => error instanceof BrowserLocalPreviewDenied && error.reason === "not-html",
    );
  } finally {
    f.cleanup();
  }
});