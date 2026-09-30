import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ImagePreview.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("composer attachments render as a board chip row, one remove button per image", async () => {
  const inputSource = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  assert.match(inputSource, /import \{ ImagePreview \} from "\.\/ImagePreview"/);

  // 本轮 skin-chatinput 把图片附件区换成画板 20 的 `.pw-chips` 芯片行：
  // 一条芯片行里，每个附件 = 缩略图 ImagePreview + 一枚 `.pw-iconbtn.sm` 移除钮。
  const start = inputSource.indexOf("{attachedImages.length > 0 && (");
  assert.ok(start > -1, "图片附件区仍然存在");
  const end = inputSource.indexOf("{referenceAttachments.length > 0", start);
  assert.ok(end > start, "图片附件区与文件附件区仍然分得开");
  const chips = inputSource.slice(start, end);

  assert.match(chips, /<div className="pw-chips">/, "附件行挂在画板的 .pw-chips 上");
  assert.match(chips, /<ImagePreview key=\{img\.previewUrl\} src=\{img\.previewUrl\}>/);
  assert.match(chips, /<img[\s\S]*?src=\{img\.previewUrl\}[\s\S]*?\/>/, "缩略图仍是共享预览的 children");
  assert.match(
    chips,
    /<\/ImagePreview>\s*<button[\s\S]*?type="button"[\s\S]*?className="pw-iconbtn sm[\s\S]*?onClick=\{\(\) => removeImage\(i\)\}[\s\S]*?aria-label=\{t\("chat\.removeAttachment"\)\}[\s\S]*?<i data-ico="x"/,
    "每张图紧跟一枚画板的 .pw-iconbtn.sm 移除钮（图标走 data-ico）",
  );
  assert.doesNotMatch(chips, /<svg/, "移除钮不再手绘 × SVG");
  assert.doesNotMatch(chips, /borderRadius: "50%"/, "旧的 16px 圆形移除钮已经退役");
  assert.doesNotMatch(chips, /display: "flex", gap: 6, marginBottom: 6/, "芯片行的排布交给 .pw-chips");
});

test("uses a native modal dialog and restores focus to its trigger", () => {
  assert.match(source, /useRef<HTMLDialogElement>\(null\)/);
  assert.match(source, /dialog\.showModal\(\)/);
  assert.match(source, /closeButtonRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /const trigger = triggerRef\.current[\s\S]*?trigger\?\.isConnected[\s\S]*?trigger\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(source, /createPortal/);
});

test("Escape closes image preview without reaching global shortcuts", () => {
  assert.match(
    source,
    /const closePreview = \(\) => \{[\s\S]*?dialogRef\.current\?\.open[\s\S]*?dialogRef\.current\.close\(\)[\s\S]*?setOpen\(false\)/,
  );
  assert.match(
    source,
    /event\.key !== "Escape"[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.stopPropagation\(\)[\s\S]*?closePreview\(\)/,
  );
  assert.match(
    source,
    /onCancel=\{\(event\) => \{[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.stopPropagation\(\)[\s\S]*?closePreview\(\)/,
  );
});

test("closes only when the backdrop itself is clicked", () => {
  assert.match(source, /event\.target === event\.currentTarget[\s\S]*?closePreview\(\)/);
});

test("keeps the lightbox inside mobile safe areas", () => {
  // 灯箱的四边安全区仍由原生 dialog 的壳承担（画板 50「壳的约定」：窄屏四边各留 16px，
  // 不铺满到刘海下面）。关闭钮已经搬进壳内，不再依赖绝对定位。
  assert.match(
    cssSource,
    /\.image-preview-dialog \{[\s\S]*?env\(safe-area-inset-top\)[\s\S]*?env\(safe-area-inset-right\)[\s\S]*?env\(safe-area-inset-bottom\)[\s\S]*?env\(safe-area-inset-left\)/,
  );
  assert.match(source, /className="image-preview-dialog"/, "壳仍挂着 .image-preview-dialog");
  assert.doesNotMatch(
    source,
    /className="image-preview-close/,
    "关闭钮不再用绝对定位的 .image-preview-close（与 fork/AttachmentPreview.tsx 一起退役）",
  );
});

test("fork:design-system —— 灯箱壳换画板 50 的 pw-modal 结构，关闭钮走 data-ico", () => {
  const lightbox = source.slice(source.indexOf("{open && ("));

  assert.match(lightbox, /className="pw-modal"/, "灯箱壳是画板的 .pw-modal");
  assert.match(lightbox, /<div className="pw-modal-head">/, "壳头是 .pw-modal-head");
  assert.match(lightbox, /<div className="pw-modal-body"/, "图片本体在 .pw-modal-body 里");
  assert.match(lightbox, /<div className="pw-modal-foot">/, "壳脚是 .pw-modal-foot");
  assert.match(
    lightbox,
    /<span className="pw-ico"><i data-ico="image" data-size="16"><\/i><\/span>/,
    "壳头左侧是画板的 image 图标",
  );
  assert.match(
    lightbox,
    /<button\s+ref=\{closeButtonRef\}\s+type="button"\s+className="pw-iconbtn"[\s\S]*?<span className="pw-ico"><i data-ico="x" data-size="16"><\/i><\/span>/,
    "关闭钮是画板的 .pw-iconbtn，图标走 data-ico（与 fork/AttachmentPreview.tsx 同一写法）",
  );
  assert.doesNotMatch(lightbox, /<svg/, "灯箱里不再手绘 SVG");
  // 与兄弟组件一致：全屏定位与遮罩仍由原生 dialog 的壳承担，焦点陷阱不靠 CSS。
  assert.match(lightbox, /className="image-preview-dialog"/);
});
