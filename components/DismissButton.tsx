"use client";

import { useIsMobile } from "@/hooks/useIsMobile";

/**
 * 行内错误/结果提示上的关闭按钮。
 *
 * fork:design-components —— 画板 D-26 帧 C 的横幅关闭钮：`.d-iconbtn` + `x` 图标
 * （`data-ico` 水合），不再手绘 SVG。
 *
 * fork:v5-frame-audit —— 补 D-28 帧 F / D-29 帧 F 的 **按压反馈**：`.d-pressable`
 * （库里的类，`:active` 时缩到 0.97、松手弹回、减弱动效只缩不弹）。台账把它记成
 * 「缺口」，而这一颗关闭钮正是横幅上最常被按住的可点件。
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
      className={isMobile ? "m-iconbtn m-touch-44" : "d-iconbtn d-pressable"}
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      <i data-ico="x" data-size="13" aria-hidden="true" />
    </button>
  );
}
