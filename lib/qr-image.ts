/**
 * fork:lan-pair-qr —— 把 `QrCode` 摊成一张可直接画的位图。
 *
 * 单独一个模块而不是把算画布的代码塞进组件：静区宽度、缩放、**静区必须是浅色**
 * 这三件事是「能不能被手机相机扫到」的真正约束，值得能被测到（`qr-image.test.mjs`），
 * 而组件只负责把矩阵涂到 canvas 上。
 */

import { QrCode, type QrEcLevel } from "./qrcode";

/** ISO/IEC 18004 建议的静区 4 个模块；少一个模块的边距在弱光/斜视时就会掉识别率。 */
export const QR_QUIET_ZONE_MODULES = 4;

export interface QrImageOptions {
  ecLevel?: QrEcLevel;
  /** 静区宽度（模块数）。默认 4。 */
  quietZone?: number;
  /** 一个模块画几个 CSS 像素。默认 6 —— 手机在 30cm 外要看得清。 */
  scale?: number;
}

export interface QrImage {
  /** 含静区的方阵，true = 深色模块。行优先，长度 = width * height。 */
  modules: boolean[];
  /** 含静区的边长（模块数）。 */
  size: number;
  /** 画布边长（CSS 像素）。 */
  pixels: number;
  version: number;
  ecLevel: QrEcLevel;
}

export function qrImage(text: string, options: QrImageOptions = {}): QrImage {
  const ecLevel = options.ecLevel ?? "M";
  const quietZone = Math.max(0, Math.trunc(options.quietZone ?? QR_QUIET_ZONE_MODULES));
  const scale = Math.max(1, Math.trunc(options.scale ?? 6));
  const qr = QrCode.encodeText(text, ecLevel);
  const size = qr.size + quietZone * 2;
  const modules = new Array<boolean>(size * size).fill(false);

  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (!qr.module(x, y)) continue;
      modules[(y + quietZone) * size + (x + quietZone)] = true;
    }
  }

  return { modules, size, pixels: size * scale, version: qr.version, ecLevel };
}
