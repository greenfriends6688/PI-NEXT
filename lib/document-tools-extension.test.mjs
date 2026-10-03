import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { isWriteToolName, isEditToolName } from "./tool-names.ts";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  createDocumentToolsExtension,
  HOST_DOCUMENT_EXTENSION_NAME,
  DOCUMENT_READ_TOOL_NAMES,
  DOCUMENT_WRITE_TOOL_NAMES,
} = await jiti.import("./document-tools-extension.ts");

/** 加载扩展并收下它注册的工具；roots 指向临时目录，于是授权判定不依赖会话库。 */
async function loadTools(root) {
  const tools = new Map();
  const extension = createDocumentToolsExtension({ getRoots: async () => new Set([root]) });
  assert.equal(extension.name, HOST_DOCUMENT_EXTENSION_NAME);
  assert.equal(extension.hidden, true, "内置扩展不出现在扩展列表里");
  await extension.factory({ registerTool(tool) { tools.set(tool.name, tool); } });
  return tools;
}

function context(cwd) {
  return { cwd };
}

async function call(tools, name, params, cwd) {
  const tool = tools.get(name);
  assert.ok(tool, `没有注册 ${name}`);
  return tool.execute("call-1", params, undefined, undefined, context(cwd));
}

function textOf(result) {
  return result.content.map((part) => part.text).join("\n");
}

async function withTempDir(run) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-doc-")));
  try {
    return await run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("工具形状：11 个工具名不碰保留名，schema 与描述齐全", async () => {
  const tools = await loadTools(os.tmpdir());
  const names = [...tools.keys()];
  assert.deepEqual(names, [
    "read_docx", "write_docx", "edit_docx",
    "read_xlsx", "write_xlsx", "edit_xlsx",
    "read_pptx", "write_pptx", "edit_pptx",
    "read_pdf", "write_pdf",
  ]);
  assert.deepEqual([...DOCUMENT_READ_TOOL_NAMES, ...DOCUMENT_WRITE_TOOL_NAMES].sort(), [...names].sort());
  for (const reserved of ["Agent", "get_subagent_result", "steer_subagent"]) {
    assert.ok(!names.includes(reserved), `不能占用保留名 ${reserved}`);
  }

  for (const [name, tool] of tools) {
    assert.ok(tool.label && tool.label.length > 0, `${name} 缺 label（UI 上的名字）`);
    assert.ok(tool.description.length > 40, `${name} 的描述太短，模型判断不了怎么用`);
    assert.ok(tool.parameters, `${name} 缺 parameters`);
    assert.equal(tool.parameters.type, "object", `${name} 的 schema 必须是对象`);
    assert.ok(tool.parameters.properties.path, `${name} 必须收 path`);
    assert.ok(
      JSON.stringify(tool.parameters.properties).includes("description"),
      `${name} 的参数要有 description`,
    );
  }

  // 写工具的名字能被既有的写入文件统计认出（消息流里的「本轮写入文件」chip）。
  for (const name of DOCUMENT_WRITE_TOOL_NAMES) {
    assert.ok(isWriteToolName(name) || isEditToolName(name), `${name} 应被 lib/tool-names.ts 认成写工具`);
  }
  for (const name of DOCUMENT_READ_TOOL_NAMES) {
    assert.ok(!isWriteToolName(name) && !isEditToolName(name), `${name} 不应被认成写工具`);
  }
});

test("往返：write_docx → read_docx → edit_docx → read_docx", async () => {
  await withTempDir(async (root) => {
    const tools = await loadTools(root);
    const written = await call(tools, "write_docx", {
      path: "报告.docx",
      title: "报告",
      blocks: [
        { type: "heading", level: 1, text: "季度报告" },
        { type: "paragraph", text: "收入 120 万。" },
        { type: "bullet", text: "要点一" },
        { type: "table", rows: [["指标", "值"], ["收入", "120"]] },
      ],
    }, root);
    assert.equal(written.isError, undefined);
    assert.match(textOf(written), /已写入 .*报告\.docx/);
    assert.equal(written.details.ok, true);
    assert.equal(written.details.path, path.join(root, "报告.docx"));
    assert.ok(fs.existsSync(path.join(root, "报告.docx")), "文件真的落盘了");

    const read = await call(tools, "read_docx", { path: "报告.docx" }, root);
    assert.match(textOf(read), /\[0\]\(Heading1\) 季度报告/);
    assert.match(textOf(read), /\[1\] 收入 120 万。/);
    assert.match(textOf(read), /表格 0：2 行 × 2 列/);

    const edited = await call(tools, "edit_docx", {
      path: "报告.docx",
      target: "paragraph",
      paragraph_index: 1,
      text: "收入 150 万。",
    }, root);
    assert.equal(edited.isError, undefined);
    const after = await call(tools, "read_docx", { path: "报告.docx" }, root);
    assert.match(textOf(after), /\[1\] 收入 150 万。/);
    assert.match(textOf(after), /\[0\]\(Heading1\) 季度报告/, "别的段落没被动");

    const cell = await call(tools, "edit_docx", {
      path: "报告.docx",
      target: "table_cell",
      table_index: 0,
      row: 1,
      column: 1,
      text: "150",
    }, root);
    assert.equal(cell.isError, undefined);
    const final = await call(tools, "read_docx", { path: "报告.docx" }, root);
    assert.match(textOf(final), /\(1,1\) 150/);
  });
});

test("往返：write_xlsx → read_xlsx → edit_xlsx → read_xlsx", async () => {
  await withTempDir(async (root) => {
    const tools = await loadTools(root);
    await call(tools, "write_xlsx", {
      path: "表.xlsx",
      sheets: [{ name: "数据", rows: [["指标", "本周"], ["收入", "120"]] }],
    }, root);

    const listed = await call(tools, "read_xlsx", { path: "表.xlsx" }, root);
    assert.match(textOf(listed), /数据：2 行 × 2 列/);

    const read = await call(tools, "read_xlsx", { path: "表.xlsx", sheet: "数据", range: "A1:B2" }, root);
    assert.match(textOf(read), /A\s+B/);
    assert.match(textOf(read), /指标\s+本周/);
    assert.match(textOf(read), /收入\s+120/);

    const written = await call(tools, "edit_xlsx", {
      path: "表.xlsx",
      sheet: "数据",
      start_cell: "A2",
      values: [["利润", "180"]],
    }, root);
    assert.equal(written.isError, undefined);
    assert.equal(written.details.cells.length, 2);

    const after = await call(tools, "read_xlsx", { path: "表.xlsx", sheet: "数据", range: "A1:B2" }, root);
    assert.match(textOf(after), /利润\s+180/);
  });
});

test("往返：write_pptx → read_pptx → edit_pptx → read_pptx", async () => {
  await withTempDir(async (root) => {
    const tools = await loadTools(root);
    await call(tools, "write_pptx", {
      path: "deck.pptx",
      slides: [{ title: "Q3", bullets: ["收入", "留存"] }, { title: "Q4" }],
    }, root);

    const read = await call(tools, "read_pptx", { path: "deck.pptx" }, root);
    assert.match(textOf(read), /共 2 页/);
    assert.match(textOf(read), /\[0\] Q3\n {4}· 收入\n {4}· 留存/);

    const edited = await call(tools, "edit_pptx", { path: "deck.pptx", slide: 0, title: "Q3 复盘" }, root);
    assert.equal(edited.isError, undefined);
    const after = await call(tools, "read_pptx", { path: "deck.pptx" }, root);
    assert.match(textOf(after), /\[0\] Q3 复盘/);
    assert.match(textOf(after), /\[1\] Q4/);
  });
});

test("往返：write_pdf → read_pdf", async () => {
  await withTempDir(async (root) => {
    const tools = await loadTools(root);
    await call(tools, "write_pdf", { path: "note.pdf", pages: [{ text: "hello\nworld" }, { text: "second page" }] }, root);
    const read = await call(tools, "read_pdf", { path: "note.pdf" }, root);
    assert.match(textOf(read), /共 2 页/);
    assert.match(textOf(read), /--- 第 1 页 ---\nhello\nworld/);
    assert.match(textOf(read), /--- 第 2 页 ---\nsecond page/);
  });
});

test("write_pdf 遇到中文时如实报告替换了多少字符", async () => {
  await withTempDir(async (root) => {
    const tools = await loadTools(root);
    const result = await call(tools, "write_pdf", { path: "cn.pdf", pages: [{ text: "季度报告" }] }, root);
    assert.match(textOf(result), /4 个非 WinAnsi 字符被替换/);
    assert.equal(result.details.replacedCharacters, 4);
  });
});

test("安全边界：roots 之外的路径一律拒绝，且不落任何文件", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-doc-in-")));
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-doc-out-")));
  try {
    const tools = await loadTools(root);
    const escape = await call(tools, "write_docx", {
      path: path.join(outside, "逃逸.docx"),
      blocks: [{ type: "paragraph", text: "x" }],
    }, root);
    assert.equal(escape.isError, true);
    assert.match(textOf(escape), /不在允许访问的目录/);
    assert.equal(fs.existsSync(path.join(outside, "逃逸.docx")), false);

    // 读一个 roots 之外的真实文件也一样被拒。
    fs.writeFileSync(path.join(outside, "别人的.docx"), "not really a docx");
    const read = await call(tools, "read_docx", { path: path.join(outside, "别人的.docx") }, root);
    assert.equal(read.isError, true);
    assert.match(textOf(read), /不在允许访问的目录|不存在/);

    // 错扩展名在授权之前就被挡掉。
    const wrongExt = await call(tools, "write_docx", {
      path: "笔记.txt",
      blocks: [{ type: "paragraph", text: "x" }],
    }, root);
    assert.equal(wrongExt.isError, true);
    assert.match(textOf(wrongExt), /只处理 \.docx/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("安全边界：含 .. 的路径被拒（isExistingPathWithinRoots 内部的 #748 判定）", async () => {
  await withTempDir(async (root) => {
    const tools = await loadTools(root);
    const result = await call(tools, "write_docx", {
      path: path.join(root, "..", "逃逸.docx"),
      blocks: [{ type: "paragraph", text: "x" }],
    }, root);
    assert.equal(result.isError, true);
    assert.match(textOf(result), /不在允许访问的目录|不存在/);
  });
});

test("已存在的文件默认不被覆盖，要覆盖必须显式 overwrite", async () => {
  await withTempDir(async (root) => {
    const tools = await loadTools(root);
    const blocks = [{ type: "paragraph", text: "第一版" }];
    await call(tools, "write_docx", { path: "a.docx", blocks }, root);
    const blocked = await call(tools, "write_docx", { path: "a.docx", blocks }, root);
    assert.equal(blocked.isError, true);
    assert.match(textOf(blocked), /文件已存在/);
    assert.match(textOf(await call(tools, "read_docx", { path: "a.docx" }, root)), /第一版/);

    const forced = await call(tools, "write_docx", { path: "a.docx", blocks: [{ type: "paragraph", text: "第二版" }], overwrite: true }, root);
    assert.equal(forced.isError, undefined);
    assert.match(textOf(await call(tools, "read_docx", { path: "a.docx" }, root)), /第二版/);
  });
});

test("编辑失败时原文件一个字节都没变", async () => {
  await withTempDir(async (root) => {
    const tools = await loadTools(root);
    await call(tools, "write_docx", {
      path: "keep.docx",
      blocks: [{ type: "paragraph", text: "原文" }],
    }, root);
    const before = fs.readFileSync(path.join(root, "keep.docx"));
    const failed = await call(tools, "edit_docx", { path: "keep.docx", target: "paragraph", paragraph_index: 42, text: "x" }, root);
    assert.equal(failed.isError, true);
    assert.deepEqual(fs.readFileSync(path.join(root, "keep.docx")), before);
    assert.deepEqual(fs.readdirSync(root), ["keep.docx"], "不留 staging 临时文件");
  });
});

test("参数缺失时报错说的是缺哪个参数", async () => {
  await withTempDir(async (root) => {
    const tools = await loadTools(root);
    await call(tools, "write_docx", { path: "x.docx", blocks: [{ type: "paragraph", text: "a" }] }, root);
    const missing = await call(tools, "edit_docx", { path: "x.docx", target: "table_cell", text: "a" }, root);
    assert.equal(missing.isError, true);
    assert.match(textOf(missing), /必须给 table_index/);

    const badSheet = await call(tools, "edit_xlsx", {
      path: "x.docx",
      sheet: "Sheet1",
      start_cell: "A1",
      values: [["a"]],
    }, root);
    assert.equal(badSheet.isError, true);
    assert.match(textOf(badSheet), /只处理 \.xlsx/);
  });
});