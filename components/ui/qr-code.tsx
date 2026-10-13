"use client";

import { useMemo, type JSX } from "react";
import { QrCode as QrSymbol } from "@/lib/qrcode";
import { cn } from "@/lib/utils";

/**
 * fork:fastvibe-stack (H2) — 从 FastVibe `components/ui/qr-code.tsx` 搬来。
 *
 * **与原版的唯一差异：编码器换成本仓 vendor 的那份**（`lib/qrcode.ts`，ISO/IEC 18004
 * 逐字节对拍过 `qrcode` 参考库并用 jsQR 真解过），所以不引 `qrcode` 依赖。
 * 原版是 `QRCode.create(value, { errorCorrectionLevel })` → `modules.path`；
 * 本仓等价物是 `QrSymbol.encodeText(value, level)` + 这里自己摊平为 path。
 * 摊平逻辑与 FastVibe 的 `lib/qr-path.ts` 逐字一致（`y * size + x`，**不要**
 * 写成 `x * size + y` —— 那是转置，图案看着仍像二维码但相机扫不出来），
 * 所以原版把这一步单独写成模块并带测试。
 *
 * A QR code, as one SVG path.
 *
 * Drawn rather than rasterised: `toDataURL` would hand back a PNG at a fixed pixel size
 * that a 2× screen has to smooth, and a QR code is the one image where smoothed edges
 * cost something real — the scanner is thresholding those edges. The module matrix is
 * laid out as a path of 1×1 rects at `shapeRendering="crispEdges"`, so it scales to any
 * box the layout gives it and stays sharp.
 *
 * Always black on white, in both themes. The colours are not decoration here: a
 * scanner looks for a high-contrast pattern in the orientation it expects, and an
 * inverted code (light modules on a dark card) is refused outright by a good number of
 * phone cameras. So the card brings its own white background rather than inheriting the
 * surface it sits on.
 */

/**
 * One `1×1` subpath per dark module（仓 FastVibe `lib/qr-path.ts`，含其坐标约定）。
 *
 * Not merged into runs: `qrcode`'s own renderer coalesces horizontal ones to shorten the
 * string, which matters when the path is going down a wire; here it goes into the DOM of
 * a settings pane, where a few extra kilobytes buy code that can be checked by reading it.
 */
function qrPathof(symbol: QrSymbol): { size: number; path: string } {
  const size = symbol.size;
  const parts: string[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (symbol.module(x, y)) parts.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return { size, path: parts.join("") };
}

export function QrCode({
  value,
  className,
  title,
}: {
  value: string;
  className?: string;
  title?: string;
}): JSX.Element | null {
  const drawing = useMemo(() => {
    try {
      // Level M: the standard trade-off, and the one every camera app assumes. A URL
      // from either tunnel is 40–60 characters, which fits a version-3/4 symbol — small
      // enough that the modules stay large at the size this renders at.
      return qrPathof(QrSymbol.encodeText(value, "M"));
    } catch {
      // Only thrown by a value too long for any version, which no tunnel URL is. A
      // missing code is better than a crashed settings pane either way.
      return null;
    }
  }, [value]);

  if (!drawing) return null;

  // The four-module quiet zone is part of the spec, not padding: without it a scanner
  // cannot find the symbol's edge against whatever is next to it.
  const quiet = 4;
  const span = drawing.size + quiet * 2;

  return (
    <svg
      viewBox={`${-quiet} ${-quiet} ${span} ${span}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={title ?? value}
      className={cn("size-40 rounded-lg bg-white", className)}
    >
      <title>{title ?? value}</title>
      {/* 非主题值：二维码必须是纯黑 —— 相机的阈值判断找的就是高对比度图案，
          跟着主题走的 `var(--text)` 在深色主题下会给出近白色，那等于把码反相，
          不少手机相机会直接拒识。FastVibe 原版也是写死的 `#000000`。 */}
      <path d={drawing.path} fill="#000000" />
    </svg>
  );
}
