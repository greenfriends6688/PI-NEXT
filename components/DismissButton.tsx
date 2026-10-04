"use client";

import { useIsMobile } from "@/hooks/useIsMobile";

/**
 * 行内错误/结果提示上的关闭按钮。
 *
 * fork:design-components —— 画板 D-26 帧 C 的横幅关闭钮：`.d-iconbtn` + `x` 图标
 * （`data-ico` 水合），不再手绘 SVG。
 *
 * fork:v5-wave-b-sysstate —— 窄屏换成 PWA 的 `.m-iconbtn`，并补 `.m-touch-44`：
 * `.m-iconbtn` 的视觉高度是 `--nx-ctl-sm`（36px），低于 M-11 帧 C 的硬下限，
 * 命中区必须自己补到 44（规格与实现读同一批类，不另写数值）。
 */
export function DismissButton({ onClick, title }: { onClick: () => void; title: string }) {
  const isMobile = useIsMobile();

  return (
    <button
      type="button"
      className={isMobile ? "m-iconbtn m-touch-44" : "d-iconbtn"}
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      <i data-ico="x" data-size="13" aria-hidden="true" />
    </button>
  );
}
