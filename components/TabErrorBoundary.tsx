"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";

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
 * 形态照抄画板 61「应用级错误页」A 段的 DOM：`.pw-empty` / `.pw-empty-inner` /
 * `.pw-btn`，图标 `triangle-alert` 走 data-ico。**不新增任何 `.pw-*` 类**。
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
  return (
    /* `.pw-empty` 是画板 31/30 的空态容器（flex:1 + place-items:center），
       `height: 100%` 让它在 tab 容器（height 100% 的普通块）里也撑满。 */
    <div className="pw-empty" role="alert" style={{ height: "100%" }}>
      <div className="pw-empty-inner">
        <span className="mark" style={{ color: "var(--error)" }}>
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="20" aria-hidden="true"></i></span>
        </span>
        <h2>{t("tabs.errorTitle")}</h2>
        <p>{t("tabs.errorHint", { name: label })}</p>
        <div className="pw-inline">
          <button type="button" className="pw-btn primary" onClick={onRetry}>
            <span className="pw-ico"><i data-ico="rotate-cw" data-size="13" aria-hidden="true"></i></span>
            {t("tabs.errorRetry")}
          </button>
          {onClose && (
            <button type="button" className="pw-btn outline" onClick={onClose}>
              <span className="pw-ico"><i data-ico="x" data-size="13" aria-hidden="true"></i></span>
              {t("tabs.errorClose")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}