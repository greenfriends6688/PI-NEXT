// fork:design-components —— 附件预览弹窗钉在画板 50 的对话框基元上。
//
// 迁移前弹窗是自绘的：内联盒 + `--bg-elev` 底 + `--radius-xl` 圆角 + `--shadow-lg`
// 阴影 + 绝对定位的 `.image-preview-close`，外加一枚手绘的 × SVG。
// 现在：`.pw-modal` / `.pw-modal-head` / `.pw-modal-body` / `.pw-modal-foot` 拼出来，
// 关闭钮是画板头部的 `.pw-iconbtn.sm`，等宽正文走画板 10 的 `.pw-code`，
// 截断脚注走 `.pw-card-foot`。
// `<dialog>` 的壳（.image-preview-dialog）留着：它是原生 dialog 的全屏定位与遮罩，
// 与 ImagePreview 共用，焦点陷阱 / Esc / 遮罩点击都靠它。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AttachmentPreview.tsx", import.meta.url), "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("弹窗由画板 D-03b 帧 E 的对话框基元拼成", () => {
  assert.match(code, /className="d-modal-box"/, "壳是 .d-modal-box");
  assert.match(code, /className="d-modal-head"/, "有头");
  assert.match(code, /className="d-modal-body"/, "有体");
  assert.match(code, /className="d-modal-foot"/, "有脚");
  assert.match(code, /className="d-iconbtn"/, "关闭钮是画板头部的 .d-iconbtn");
  assert.match(code, /<span className="d-grow" \/>/, "脚部用画板的 .d-grow 把关闭钮推到右侧");
});

test("文本分支用画板 D-03b 的代码卡，截断脚注用 .d-t-xs.d-t-faint", () => {
  assert.match(code, /<div className="d-code"/, "等宽正文走 .d-code");
  assert.match(code, /<div className="d-code-body">/, "正文走 .d-code-body");
  assert.match(code, /className="d-t-xs d-t-faint"/, "截断提示走 .d-t-xs.d-t-faint");
  assert.match(code, /<div className="d-banner err">/, "读取失败走 .d-banner.err");
});

test("零手绘 SVG、零自绘灯箱盒", () => {
  assert.doesNotMatch(code, /<svg/, "图标一律走 <i data-ico>");
  assert.doesNotMatch(code, /image-preview-close/, "自绘的绝对定位关闭钮已经退役");
  assert.doesNotMatch(code, /boxShadow/, "灯箱阴影归 .pw-modal");
  assert.doesNotMatch(code, /borderRadius/, "灯箱圆角归 .pw-modal");
});

test("原生 dialog 的焦点与关闭行为没丢", () => {
  assert.match(code, /<dialog[\s\S]*?className="image-preview-dialog"/, "仍然是原生 <dialog>");
  assert.match(code, /dialog\.showModal\(\)/, "仍然是 showModal（焦点陷阱靠它）");
  assert.match(code, /closeButtonRef\.current\?\.focus\(\{ preventScroll: true \}\)/, "打开时焦点进关闭钮");
  assert.match(code, /trigger\.focus\(\{ preventScroll: true \}\)/, "关闭后焦点回触发钮");
  assert.match(code, /document\.body\.style\.overflow = "hidden"/, "打开时锁 body 滚动");
  assert.match(code, /event\.key !== "Escape"/, "Esc 关闭");
  assert.match(code, /onCancel=\{\(event\) =>/, "原生 cancel 事件也接住了");
  assert.match(code, /event\.target === event\.currentTarget\) closePreview\(\)/, "点遮罩关闭");
});

test("六个分支与图片复用都在", () => {
  assert.match(code, /if \(kind === "image"\) \{[\s\S]*?<ImagePreview src=\{src\} alt=\{name\}/, "图片仍然复用 ImagePreview");
  for (const kind of ['case "pdf":', 'case "docx":', 'case "audio":', 'case "video":', 'case "text":']) {
    assert.ok(code.includes(kind), `缺少 ${kind}`);
  }
  assert.match(code, /src=\{previewSrc \?\? src\}/, "docx 仍然优先服务端预览地址");
  assert.match(code, /sandbox="allow-same-origin"/, "docx 的 sandbox 没变");
  assert.match(code, /firstPreviewLines\(content\)/, "文本仍然只取前 N 行");
  assert.match(code, /t\("chat\.previewTextTruncated", \{ count: TEXT_PREVIEW_MAX_LINES \}\)/, "截断脚注的 key 与条数没变");
});

test("i18n key 一个没动", () => {
  for (const key of [
    "chat.previewAttachment",
    "chat.previewLoading",
    "chat.previewTextFailed",
    "chat.previewTextTruncated",
    "chat.previewUnsupported",
    "chat.close",
  ]) {
    assert.ok(code.includes(`"${key}"`), `缺少 ${key}`);
  }
});
