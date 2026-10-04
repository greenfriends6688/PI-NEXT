import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./DirectoryPicker.tsx", import.meta.url), "utf8");

test("fork:design-components —— 自绘降级态挂画板 D-26b 帧 A 的 d-modal 三段式", () => {
  const head = source.indexOf('<div className="d-modal-head d-row">');
  const body = source.indexOf('<div className="d-modal-body"');
  const foot = source.indexOf('className="directory-picker-footer d-modal-foot"');

  assert.match(source, /className="directory-picker-backdrop d-modal is-open"/, "壳是画板的 .d-modal.is-open");
  assert.match(source, /className="directory-picker-panel d-modal-box"/, "盒子是 .d-modal-box");
  assert.ok(head > -1, "壳头是 .d-modal-head");
  assert.ok(body > head, "正文块在壳头之后");
  assert.ok(foot > body, "壳脚在正文块之后");
  // 画板 D-26b 帧 A：folder-open 图标 + 标题 + 「转到上级目录」d-btn.sm + d-iconbtn 关闭。
  assert.match(
    source.slice(head, body),
    /<i data-ico="folder-open" data-size="16" aria-hidden="true" \/>/,
    "壳头左侧是画板的 folder-open 图标",
  );
  assert.match(
    source.slice(head, body),
    /<span className="d-grow">\{t\("directoryPicker\.selectDirectory"\)\}<\/span>/,
    "标题占 d-grow，把右侧动作推到最右",
  );
  assert.match(source.slice(head, body), /className="directory-picker-back d-btn sm"/, "「转到上级目录」是 .d-btn.sm");
  assert.match(source.slice(head, body), /<i data-ico="arrow-up" data-size="13" aria-hidden="true" \/>/, "「转到上级目录」用 arrow-up 图标");
  assert.match(source.slice(head, body), /className="d-iconbtn"/, "关闭钮是 .d-iconbtn");
  assert.match(source.slice(head, body), /<i data-ico="x" data-size="14" aria-hidden="true" \/>/, "关闭钮用 x 图标");
});

test("fork:design-components —— 目录列表是画板的 .d-tree + .d-trow.l1", () => {
  const list = source.slice(source.indexOf('className="directory-picker-list d-tree"'));

  assert.match(list, /className="directory-picker-list d-tree"/, "列表容器挂 .d-tree");
  assert.match(list, /className="directory-picker-entry d-trow l1"/, "盘符行 / 目录行是 .d-trow.l1");
  assert.match(list, /className="directory-picker-row d-trow l1"/, "行的外壳（重命名 / 确认删除态）也是 .d-trow.l1");
  assert.match(list, /<i data-ico="hard-drive" data-size="14" aria-hidden="true" \/>/, "盘符行是画板的 hard-drive 图标");
  assert.match(list, /<i data-ico="folder" data-size="14" aria-hidden="true" \/>/, "目录行是画板的 folder 图标");
  assert.match(list, /<i data-ico="square-pen" data-size="13" aria-hidden="true" \/>/, "重命名是画板的 square-pen");
  assert.match(list, /<i data-ico="trash-2" data-size="13" aria-hidden="true" \/>/, "删除是画板的 trash-2");
  assert.match(list, /className="directory-picker-rename d-iconbtn"/, "重命名钮是 .d-iconbtn");
  assert.match(list, /className="d-banner err" role="alert"/, "错误行用画板的 .d-banner.err");
  // 删除确认长在那一行上（不弹第二个模态），行底走 danger 语义色。
  assert.match(list, /className="directory-picker-delete d-btn sm danger"/, "删除确认是 .d-btn.danger");
  assert.match(list, /color-mix\(in srgb, var\(--nx-danger\) 7%, transparent\)/, "确认删除的行底是 danger 语义色");
});

test("fork:design-components —— 壳脚是 .d-modal-foot，取消 / 选中两枚 .d-btn", () => {
  const foot = source.slice(source.indexOf('className="directory-picker-footer d-modal-foot"'));

  assert.match(foot, /<button className="directory-picker-action d-btn" type="button" onClick=\{onCancel\}/);
  assert.match(foot, /className="directory-picker-action d-btn primary"/, "「选择此文件夹」是 .d-btn.primary");
  assert.match(foot, /disabled=\{!canSelect\}/, "不可选时仍然禁用");
  assert.match(foot, /title=\{hasUncommittedPath \? t\("directoryPicker\.openBeforeSelecting"\) : t\("directoryPicker\.selectCurrentDirectory"\)\}/);
});

test("fork:design-components —— 路径行与新建表单改画板的 .d-searchfield", () => {
  const body = source.slice(source.indexOf('<div className="d-modal-body"'), source.indexOf('className="directory-picker-list d-tree"'));

  assert.match(body, /<form onSubmit=\{handlePathSubmit\} className="d-searchfield">/, "路径行是 .d-searchfield");
  assert.match(body, /className="directory-picker-path d-mono"/, "路径输入是 .d-mono");
  assert.match(body, /<form onSubmit=\{handleOperationSubmit\} className="d-searchfield">/, "新建文件夹行也是 .d-searchfield");
  assert.match(body, /<i data-ico="folder-plus" data-size="13" aria-hidden="true" \/>/, "新建用 folder-plus 图标");
  assert.match(body, /className="directory-picker-action d-btn sm primary"/, "创建确认是 .d-btn.sm.primary");
  // 画板 D-26b 帧 A「未提交提示」：输入框路径与当前目录不一致时给一条 warning 横幅。
  assert.match(body, /className="d-banner warn"[\s\S]*?<i data-ico="triangle-alert" data-size="14" aria-hidden="true" \/>/, "未提交提示是 .d-banner.warn");
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
