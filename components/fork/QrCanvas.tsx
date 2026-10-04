"use client";

import { useEffect, useRef } from "react";

import { qrImage } from "@/lib/qr-image";

/**
 * fork:lan-pair-qr —— 配对/接入共用的二维码画布。
 *
 * 从 LanPairPanel 抽出来：微信 iLink 注册码与飞书授权链接都是**一个字符串**，画法与
 * 配对码完全一致。**静区在 lib/qr-image.ts 里**（那里测得到），这里只涂格子；纯白底
 * 纯黑模块是刻意的非主题值（低对比会掉识别率）。
 */
export function QrCanvas({ content, label, scale = 6 }: { content: string; label: string; scale?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !content) return;
    let image;
    try {
      image = qrImage(content, { scale });
    } catch {
      return;
    }
    canvas.width = image.pixels;
    canvas.height = image.pixels;
    const context = canvas.getContext("2d");
    if (!context) return;
    const cell = image.pixels / image.size;
    context.fillStyle = "#ffffff"; // 非主题值：QR 必须纯白底
    context.fillRect(0, 0, image.pixels, image.pixels);
    context.fillStyle = "#000000"; // 非主题值：深色模块纯黑，低对比会掉识别
    for (let y = 0; y < image.size; y++) {
      for (let x = 0; x < image.size; x++) {
        if (!image.modules[y * image.size + x]) continue;
        context.fillRect(Math.round(x * cell), Math.round(y * cell), Math.ceil(cell), Math.ceil(cell));
      }
    }
  }, [content, scale]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      style={{
        maxWidth: "100%",
        height: "auto",
        imageRendering: "pixelated",
        background: "var(--nx-surface)",
        borderRadius: "var(--nx-r-md)",
      }}
    />
  );
}
