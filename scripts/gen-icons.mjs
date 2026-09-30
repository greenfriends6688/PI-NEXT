// gen-icons.mjs — 从品牌图生成全平台图标
// 用法: node scripts/gen-icons.mjs   (在项目根目录运行)
//
// 唯一素材：public/pi-next-logo.png（主品牌渐变图形，透明底 708×435）。
// 这里只做**机械缩放与留白**，不改图、不叠底、不重画：
//   build/icon.icns            应用图标（1024 → iconset → icns，透明方底）
//   build/icon.png             1024 master（调试用）
//   build/trayTemplate.png     菜单栏 template（黑色 + 原图 alpha，22pt，系统自动反白）
//   build/trayTemplate@2x.png                                    44pt
//   public/icons/icon-512.png / icon-192.png    PWA / manifest
//   public/icons/apple-touch-icon.png           iOS 主屏（白底，见下）
//   public/favicon.png / app/favicon.ico        浏览器标签页
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const SRC = join(process.cwd(), "public", "pi-next-logo.png");
const { width: SRC_W, height: SRC_H } = await sharp(SRC).metadata();
const ASPECT = SRC_W / SRC_H;

// 方底留白：图形居中占画布宽的 78%（Apple 图标安全区惯例）。
const COVER = 0.78;
// ≤32px 的光学补偿：16px 时图形只有 12px 宽、7px 高，缩略图上会糊成一团。
const COVER_SMALL = 0.94;
const SMALL_MAX_DIM = 32;

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/** 把品牌图形摆进 size×size 的方底（`background` 为 null 时留透明）。 */
async function square(size, background = null, cover = size <= SMALL_MAX_DIM ? COVER_SMALL : COVER) {
  const targetW = Math.round(size * cover);
  const mark = await sharp(SRC)
    .resize(targetW, Math.round(targetW / ASPECT), { fit: "contain", background: TRANSPARENT })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: background ?? TRANSPARENT } })
    .composite([{ input: mark, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** 菜单栏 template：只保留原图 alpha，颜色一律涂黑（系统按明暗自动反白）。 */
async function trayTemplate(size) {
  const { data, info } = await sharp(SRC)
    .resize(size, size, { fit: "contain", background: TRANSPARENT })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < data.length; i += 4) {
    out[i] = 0;
    out[i + 1] = 0;
    out[i + 2] = 0;
    out[i + 3] = data[i + 3];
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function sips(src, width, height, dst) {
  execFileSync("sips", ["-z", String(height), String(width), src, "--out", dst], { stdio: "inherit" });
}

const buildDir = join(process.cwd(), "build");
const iconsDir = join(process.cwd(), "public", "icons");
mkdirSync(buildDir, { recursive: true });

// ── 1. 应用图标（icns）─────────────────────────────────────────────────────
const masterPng = join(buildDir, "icon.png");
writeFileSync(masterPng, await square(1024));
const smallMasterPng = join(buildDir, "icon-small.png");
writeFileSync(smallMasterPng, await square(1024, null, COVER_SMALL));

const iconset = join(buildDir, "icon.iconset");
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });

const sizes = [
  [16, "icon_16x16.png"],
  [32, "icon_16x16@2x.png"],
  [32, "icon_32x32.png"],
  [64, "icon_32x32@2x.png"],
  [128, "icon_128x128.png"],
  [256, "icon_128x128@2x.png"],
  [256, "icon_256x256.png"],
  [512, "icon_256x256@2x.png"],
  [512, "icon_512x512.png"],
  [1024, "icon_512x512@2x.png"],
];
for (const [dim, name] of sizes) {
  const src = dim <= SMALL_MAX_DIM ? smallMasterPng : masterPng;
  sips(src, dim, dim, join(iconset, name));
}
execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(buildDir, "icon.icns")], { stdio: "inherit" });
rmSync(iconset, { recursive: true, force: true });
console.log("✓ build/icon.icns");

// ── 2. 菜单栏 template 图标 ────────────────────────────────────────────────
writeFileSync(join(buildDir, "trayTemplate.png"), await trayTemplate(22));
writeFileSync(join(buildDir, "trayTemplate@2x.png"), await trayTemplate(44));
console.log("✓ build/trayTemplate.png / trayTemplate@2x.png");

// ── 3. PWA / 主屏 / 标签页（web 侧与 build/ 同源同参数）─────────────────────
writeFileSync(join(iconsDir, "icon-512.png"), await square(512));
writeFileSync(join(iconsDir, "icon-192.png"), await square(192));
// iOS 会把透明区填成黑色，而主品牌图形的左半是深蓝紫 —— 必须自己给白底。
writeFileSync(join(iconsDir, "apple-touch-icon.png"), await square(180, { r: 255, g: 255, b: 255, alpha: 1 }));
console.log("✓ public/icons/icon-512.png / icon-192.png / apple-touch-icon.png");

const faviconPng = join(process.cwd(), "public", "favicon.png");
writeFileSync(faviconPng, await square(64));
// Next 的 `app/favicon.ico` 是文件约定，sips 直接写单尺寸 ico（浏览器会自行缩放）。
execFileSync("sips", ["-s", "format", "ico", faviconPng, "--out", join(process.cwd(), "app", "favicon.ico")], { stdio: "inherit" });
console.log("✓ public/favicon.png / app/favicon.ico");
