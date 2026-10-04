import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ImagePreview.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("composer attachments render as a board chip row, one remove button per image", async () => {
  const inputSource = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  assert.match(inputSource, /import \{ ImagePreview \} from "\.\/ImagePreview"/);

  // fork:v5-wave-b（M-03）—— 图片附件区现在有**两套基件**：桌面仍是画板 20 的
  // `.d-chips` 芯片行，窄屏换成 M-03 的 `.m-attachbar` 横滚托盘（`.m-attachbtn` 一格一张）。
  // 两条等式都要守：每张图一枚移除钮、缩略图仍是共享预览的 children、零手绘 SVG。
  const mobileStart = inputSource.indexOf("{attachedImages.length > 0 && (");
  assert.ok(mobileStart > -1, "窄屏的图片附件区存在");
  const desktopStart = inputSource.lastIndexOf("{attachedImages.length > 0 && (");
  assert.ok(desktopStart > mobileStart, "桌面那一段仍在（它在窄屏分支之后）");
  const end = inputSource.indexOf("{referenceAttachments.length > 0", desktopStart);
  assert.ok(end > desktopStart, "图片附件区与文件附件区仍然分得开");
  const chips = inputSource.slice(desktopStart, end);

  assert.match(chips, /<div className="d-chips">/, "附件行挂在画板的 .d-chips 上");
  assert.match(chips, /<ImagePreview key=\{img\.previewUrl\} src=\{img\.previewUrl\}>/);
  assert.match(chips, /<img[\s\S]*?src=\{img\.previewUrl\}[\s\S]*?\/>/, "缩略图仍是共享预览的 children");
  assert.match(
    chips,
    /<\/ImagePreview>\s*<button[\s\S]*?type="button"[\s\S]*?className="d-iconbtn sm[\s\S]*?onClick=\{\(\) => removeImage\(i\)\}[\s\S]*?aria-label=\{t\("chat\.removeAttachment"\)\}[\s\S]*?<i data-ico="x"/,
    "每张图紧跟一枚画板的 .d-iconbtn.sm 移除钮（图标走 data-ico）",
  );
  assert.doesNotMatch(chips, /<svg/, "移除钮不再手绘 × SVG");
  assert.doesNotMatch(chips, /borderRadius: "50%"/, "旧的 16px 圆形移除钮已经退役");
  assert.doesNotMatch(chips, /display: "flex", gap: 6, marginBottom: 6/, "芯片行的排布交给 .pw-chips");

  // 窄屏那一段的等价约束：`.m-attachbar` › `.m-attachbtn` › ImagePreview › 移除钮。
  const pwaEnd = inputSource.indexOf("{referenceAttachments.length > 0", mobileStart);
  assert.ok(pwaEnd > mobileStart, "窄屏的图片附件区与文件附件区仍然分得开");
  const pwaChips = inputSource.slice(mobileStart, pwaEnd);
  assert.match(pwaChips, /<div className="m-attachbar">/, "窄屏的附件行挂在 M-03 的 .m-attachbar 上");
  assert.match(pwaChips, /<span key=\{i\} className="m-attachbtn"/, "一格一张（M-03 的 .m-attachbtn）");
  assert.match(pwaChips, /<ImagePreview key=\{img\.previewUrl\} src=\{img\.previewUrl\}>/);
  assert.match(
    pwaChips,
    /<\/ImagePreview>\s*<button[\s\S]*?className="m-iconbtn"[\s\S]*?onClick=\{\(\) => removeImage\(i\)\}[\s\S]*?aria-label=\{t\("chat\.removeAttachment"\)\}[\s\S]*?<i data-ico="x"/,
    "每张图紧跟一枚 .m-iconbtn 移除钮（图标走 data-ico）",
  );
  assert.doesNotMatch(pwaChips, /<svg/, "窄屏的移除钮同样零手绘 SVG");
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

test("fork:v5-landing —— 灯箱壳换 D-26b 的 d-modal 结构，关闭钮走 data-ico", () => {
  const lightbox = source.slice(source.indexOf("{open && ("));

  // 2026-10-04（Wave B）：窄屏换 PWA 形态的模态壳，所以断言的是**形态映射**，
  // 两个形态必须挂在同一批节点上（`.m-modal-*` 与 `.d-modal-*` 一一对应）。
  assert.match(lightbox, /isMobile \? "m-modal-box" : "d-modal-box"/, "灯箱壳按断点换形态");
  assert.match(lightbox, /isMobile \? "m-modal-head" : "d-modal-head"/, "壳头按断点换形态");
  assert.match(lightbox, /isMobile \? "m-modal-body" : "d-modal-body"/, "图片本体在壳体里");
  assert.match(lightbox, /isMobile \? "m-modal-foot" : "d-modal-foot"/, "壳脚按断点换形态");
  assert.match(
    lightbox,
    /<i data-ico="image" data-size="16"><\/i>/,
    "壳头左侧是画板的 image 图标",
  );
  assert.match(
    lightbox,
    /<button\s+ref=\{closeButtonRef\}\s+type="button"\s+className=\{isMobile \? "m-iconbtn m-touch-44" : "d-iconbtn"\}[\s\S]*?<i data-ico="x" data-size="16"><\/i>/,
    "关闭钮走画板 / 形态库的动作钮，图标走 data-ico（手机档另加 44px 命中区）",
  );
  assert.doesNotMatch(lightbox, /<svg/, "灯箱里不再手绘 SVG");
  // 与兄弟组件一致：全屏定位与遮罩仍由原生 dialog 的壳承担，焦点陷阱不靠 CSS。
  assert.match(lightbox, /className="image-preview-dialog"/);
});
