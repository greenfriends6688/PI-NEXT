"use client";

/**
 * Wave B（PWA 形态）· 转录区的窄屏信号。
 *
 * 契约见 `design/v5/LANDING.md` §1 铁律一：替换一个组件只有一条路 —— 打开画板，
 * 原样复制那段 DOM（类名、嵌套层级、`<i data-ico>`、状态类一字不动）。
 *
 * 这里**不做任何类名映射表**。`d-*` 与 `m-*` 是两套各自有唯一出处的类
 * （`design/v5/web/system.css` / `design/v5/pwa/system.css`），一旦在产品侧
 * 写一张 `d-xxx → m-yyy` 的翻译表，就等于又造了「一个视觉两个来源」——
 * 正是 LANDING §0 里翻过三次车的那件事。翻译只能发生在**组件的分支里**，
 * 由人对着画板一行行抄。
 *
 * SSR / 首帧时 `useIsMobile()` 返回 false（`getServerSnapshot`），所以桌面分支
 * 是确定的默认值，窄屏在 hydration 之后切过去 —— 与组件里既有的
 * `useIsMobile()` 用法（ChatInput / FileExplorer / ModelSelector）完全一致。
 */
import { useIsMobile } from "@/hooks/useIsMobile";

/** 窄屏（≤640px）= PWA 形态。转录区所有组件的 m-* 分支都读它。 */
export function usePwaSkin(): boolean {
  return useIsMobile();
}

/**
 * 二选一的类名：宽屏拿桌面那条，窄屏拿画板抄来的那条。
 *
 * 只在**两个形态确实是同一件东西的两种画法**时用（例如一枚按钮：桌面 `.d-btn sm`，
 * 手机 `.m-btn sm`）。结构不同的地方（消息气泡、步骤行、代码块）必须写真正的
 * 分支，不能靠换类名蒙混 —— 那正是「只加类不换 DOM」的事故形态。
 */
export function skinClass(isPwa: boolean, desktop: string, mobile: string): string {
  return isPwa ? mobile : desktop;
}