"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { PwaTabErrorState } from "./pwa/ErrorStates";

/*
 * fork:proma-38-tab-boundary — **每个 tab 的内容各包一层**错误边界。
 *
 * 为什么要单独一个：此前右栏只有一个路由级边界（`app/error.tsx`），任一预览
 * 渲染期抛错就带走整棵右栏 —— 一个 PDF 预览崩了，终端和浏览器跟着一起白屏。
 * 边界挂在这一层（`.file-panel-main` 里每个 tab 容器之内）之后：
 *
 *   · 崩的只是**那一个** tab，其余 tab（尤其终端 / 浏览器）照常在跑；
 *   · 错误态留在那个 tab 上，可以就地重试，也可以关掉它、切去别的 tab；
 *   · 边界是类组件，渲染失败时**不产生任何额外 DOM** —— 也就是不改变
 *     `.file-panel-main` 的 flex 子项结构（tab 容器仍是它唯一的直接子元素）。
 *
 * 形态照抄 v5 画板 D-26b 帧 B「段级 · app/error.tsx」的 DOM：
 * `.d-empty` / `.d-empty-ico` / `.d-empty-t` / `.d-empty-s` / `.d-row` +
 * `.d-btn`，图标 `triangle-alert` 走 data-ico。
 *
 * fork:v5-wave-b-sysstate —— 窄屏走 M-11 帧 D ⑪ 的 `.m-empty` 四件 +
 * `.m-btn.sm .m-touch-44`（见 `components/pwa/ErrorStates.tsx`）。
 * 边界本体仍是类组件、不产生额外 DOM；只有错误态那个函数组件分叉。
 */

export interface TabErrorBoundaryProps {
  /** 这层是哪个 tab 的（错误态文案与埋点用）。 */
  tabId: string;
  /** tab 的可见名，错误态里报给用户。 */
  label?: string;
  /**
   * 变了就清错误态并重挂子树。文件 tab 的 `viewerRevision` / 重开的终端走这一条：
   * 同一个 tab id 换了内容，崩过的实例不该把错误态一直带着。
   */
  resetKey?: string | number;
  /** 关掉这个 tab（错误态里的「关闭」按钮）。 */
  onClose?: () => void;
  children: ReactNode;
}

interface TabErrorBoundaryState {
  error: Error | null;
}

export class TabErrorBoundary extends Component<TabErrorBoundaryProps, TabErrorBoundaryState> {
  state: TabErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): TabErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 边界只隔离，不吞日志：完整堆栈留在控制台，和 app/error.tsx 同一套做法。
    console.error(`[pi-web] tab "${this.props.tabId}" crashed while rendering`, error, info.componentStack);
  }

  componentDidUpdate(previous: TabErrorBoundaryProps) {
    if (this.state.error === null) return;
    if (previous.resetKey === this.props.resetKey && previous.tabId === this.props.tabId) return;
    this.setState({ error: null });
  }

  private readonly retry = () => {
    // 清错误态即可：出错的子树已经被 React 删掉，重新渲染 children 就是全新挂载。
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <TabErrorState label={this.props.label ?? this.props.tabId} onRetry={this.retry} onClose={this.props.onClose} />;
  }
}

/**
 * 错误态本体。单独一个组件，是因为它要用 hook（i18n），而边界本体必须是类组件。
 */
function TabErrorState({ label, onRetry, onClose }: { label: string; onRetry: () => void; onClose?: () => void }) {
  const { t } = useI18n();
  const isMobile = useIsMobile();

  if (isMobile) {
    /* M-11 帧 D ⑪「错误页」：`.m-empty` / `.m-empty-ico`（danger）/
       `.m-empty-t` / `.m-empty-s` + 两枚 `.m-btn.sm`（重试 / 关闭）。
       两级错误页都必须给「重试」——所以关闭是可选的第二颗，不是唯一一颗。 */
    return (
      <PwaTabErrorState
        title={t("tabs.errorTitle")}
        hint={t("tabs.errorHint", { name: label })}
        style={{ height: "100%" }}
        actions={[
          { key: "retry", label: t("tabs.errorRetry"), icon: "rotate-cw", variant: "primary", onClick: onRetry },
          ...(onClose
            ? [{ key: "close", label: t("tabs.errorClose"), icon: "x", onClick: onClose } as const]
            : []),
        ]}
      />
    );
  }

  return (
    /* 画板 D-26b 帧 B「段级 · app/error.tsx」的 `.d-empty` 形态（图标 / 标题 /
       说明 / 动作行）；`height: 100%` 让它在 tab 容器里也撑满。 */
    <div className="d-empty" role="alert" style={{ height: "100%" }}>
      <div className="d-empty-ico" style={{ color: "var(--nx-danger)" }}>
        <i data-ico="triangle-alert" data-size="20" aria-hidden="true" />
      </div>
      <div className="d-empty-t">{t("tabs.errorTitle")}</div>
      <div className="d-empty-s">{t("tabs.errorHint", { name: label })}</div>
      <div className="d-row">
        <button type="button" className="d-btn sm primary" onClick={onRetry}>
          <i data-ico="rotate-cw" data-size="13" aria-hidden="true" />
          {t("tabs.errorRetry")}
        </button>
        {onClose && (
          <button type="button" className="d-btn sm" onClick={onClose}>
            <i data-ico="x" data-size="13" aria-hidden="true" />
            {t("tabs.errorClose")}
          </button>
        )}
      </div>
    </div>
  );
}