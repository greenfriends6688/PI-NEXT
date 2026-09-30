import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./DirectoryPicker.tsx", import.meta.url), "utf8");

test("fork:design-system —— 自绘降级态挂画板 50 D 段的 pw-modal 三段式", () => {
  const head = source.indexOf('<div className="pw-modal-head">');
  const body = source.indexOf('<div className="pw-modal-body"');
  const foot = source.indexOf('className="directory-picker-footer pw-modal-foot"');

  assert.match(source, /className="directory-picker-panel pw-modal"/, "壳是画板的 .pw-modal");
  assert.ok(head > -1, "壳头是 .pw-modal-head");
  assert.ok(body > head, "正文块在壳头之后");
  assert.ok(foot > body, "壳脚在正文块之后");
  // 画板 50 D 段：folder-open 图标 + 标题 + 「上一级」pw-btn.sm + pw-iconbtn.sm 关闭。
  assert.match(
    source.slice(head, body),
    /<span className="pw-ico"><i data-ico="folder-open" data-size="16"><\/i><\/span>/,
    "壳头左侧是画板的 folder-open 图标",
  );
  assert.match(
    source.slice(head, body),
    /<span className="grow">\{t\("directoryPicker\.selectDirectory"\)\}<\/span>/,
    "标题占 grow，把右侧动作推到最右",
  );
  assert.match(source.slice(head, body), /className="directory-picker-back pw-btn sm"/, "「上一级」是 .pw-btn.sm");
  assert.match(source.slice(head, body), /<i data-ico="arrow-up" data-size="13">/, "「上一级」用 arrow-up 图标");
  assert.match(source.slice(head, body), /className="pw-iconbtn sm"/, "关闭钮是 .pw-iconbtn.sm");
  assert.match(source.slice(head, body), /<i data-ico="x" data-size="14">/, "关闭钮用 x 图标");
});

test("fork:design-system —— 目录列表是画板的 .pw-list + .pw-litem", () => {
  const list = source.slice(source.indexOf('className="directory-picker-list pw-list"'));

  assert.match(list, /className="directory-picker-list pw-list"/, "列表容器挂 .pw-list");
  assert.match(list, /className="directory-picker-entry pw-litem"/, "盘符行 / 目录行是 .pw-litem");
  assert.match(list, /className="directory-picker-row pw-litem"/, "行的外壳（重命名 / 确认删除态）也是 .pw-litem");
  assert.match(list, /<Icon name="hard-drive" \/>/, "盘符行是画板的 hard-drive 图标");
  assert.match(list, /<Icon name="folder" \/>/, "目录行是画板的 folder 图标");
  assert.match(list, /<i data-ico="square-pen" data-size="13">/, "重命名是画板的 square-pen");
  assert.match(list, /<i data-ico="trash-2" data-size="13">/, "删除是画板的 trash-2");
  assert.match(list, /className="directory-picker-rename pw-iconbtn sm"/, "重命名钮是 .pw-iconbtn.sm");
  assert.match(list, /className="pw-alert"/, "错误行用画板的 .pw-alert");
});

test("fork:design-system —— 壳脚是 .pw-modal-foot，取消 / 选中两枚 .pw-btn", () => {
  const foot = source.slice(source.indexOf('className="directory-picker-footer pw-modal-foot"'));

  assert.match(foot, /<button className="directory-picker-action pw-btn" type="button" onClick=\{onCancel\}/);
  assert.match(foot, /className="directory-picker-action pw-btn primary"/, "「用这个目录」是 .pw-btn.primary");
  assert.match(foot, /disabled=\{!canSelect\}/, "不可选时仍然禁用");
  assert.match(foot, /title=\{hasUncommittedPath \? t\("directoryPicker\.openBeforeSelecting"\) : t\("directoryPicker\.selectCurrentDirectory"\)\}/);
});

test("fork:design-system —— 路径行与新建表单改画板的 .pw-inline + .pw-input", () => {
  const head = source.slice(source.indexOf('<div className="pw-modal-body"'), source.indexOf('className="directory-picker-list pw-list"'));

  assert.match(head, /<form onSubmit=\{handlePathSubmit\} className="pw-inline">/, "路径行是 .pw-inline");
  assert.match(head, /className="directory-picker-path pw-input"/, "路径输入是 .pw-input");
  assert.match(head, /<form onSubmit=\{handleOperationSubmit\} className="pw-inline">/, "新建文件夹行也是 .pw-inline");
  assert.match(head, /<i data-ico="folder-plus" data-size="13">/, "新建用 folder-plus 图标");
  assert.match(head, /className="directory-picker-action pw-btn sm primary"/, "创建确认是 .pw-btn.sm.primary");
});

test("carries no hand-drawn SVG", () => {
  assert.doesNotMatch(source, /<svg/);
});

test("keeps behavior: portal, a11y dialog and every API call", () => {
  // 系统原生选择器（那条主路径）的调用方在别处；本文件只负责自绘降级态。
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").split("//")[0];
  assert.doesNotMatch(code, /cwd\/pick/, "本文件不碰系统原生那条主路径");
  assert.match(source, /createPortal\(/, "仍然 portal 到 body");
  assert.match(source, /useDialogA11y\(\{ open: true, onClose: onCancel \}\)/, "焦点约束 hook 保留");
  assert.match(source, /if \(event\.target === event\.currentTarget && !pickerBusy\) onCancel\(\)/, "点遮罩关闭保留");
  assert.match(source, /if \(event\.key === "Escape" && !pickerBusy\) onCancel\(\)/, "Esc 关闭保留");
  assert.match(source, /\/api\/cwd\/browse/, "目录浏览接口不变");
  assert.match(source, /\/api\/cwd\/directories/, "建 / 改名 / 删除接口不变");
  assert.match(source, /method: isRename \? "PATCH" : "POST"/);
  assert.match(source, /method: "DELETE"/);
  assert.match(source, /renameInputRef\.current\?\.select\(\)/, "重命名输入框仍然全选");
  assert.match(source, /hoveredDirectoryPath/, "悬浮行状态保留");
  assert.match(source, /confirmDeletePath/, "删除二次确认保留");
});
