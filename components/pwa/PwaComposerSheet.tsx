"use client";

/*
 * fork:v5-landing Wave B —— 输入卡那条线上的**底部面板**宿主（能力面板 / 模型面板）。
 *
 * DOM 原样取自 `design/v5/pwa/boards/M-01-conversation-drawer.html` 帧 C 与
 * `M-03-composer-sheet.html` 帧 A：
 *   `.m-scrim.is-open`（点遮罩即收）+
 *   `.m-sheet.is-open` › `.m-sheet-grab` › `.m-sheet-title` › `.m-sheet-body` ›（可选）`.m-pickbar`
 * 类名、嵌套层级、状态类一字不动，只把静态文案接到真实数据。
 *
 * 为什么走 portal：画板里 `.m-sheet` 的定位祖先是 `.m-phone-inner`
 * （`position: relative`）；产品的输入卡在聊天列里正常流中，祖先链上没有那个取景框，
 * `.m-sheet` 的 `position: absolute` 会退化成相对初始包含块定位。所以外面套一层
 * `position: fixed; inset: 0` 的定位层 —— 铁律四允许的「几何定位 / z-index 层的摆放」，
 * 其余一律走 `var()`。
 *
 * 行为（焦点约束 / Esc / 遮罩点一下即收）走既有 `useDialogA11y`，与桌面弹层同一套。
 * **ref 必须挂在这层宿主上而不是 `.m-sheet` 本身**：hook 会把 ref 节点的**兄弟**
 * 设为 inert —— 挂在 sheet 上时兄弟恰好是遮罩，遮罩就被点了不动，
 * 「点空白处即收」整条失灵（2026-10-05 用户报告 + 真机复现）。挂到宿主层，
 * 兄弟变成 body 下其余节点（应用根），与 `DirectoryPicker` 的既有写法一致；
 * 遮罩作为宿主的子节点照常接手指。抓手 `.m-sheet-grab` 同理可点（div→button
 * 的既定换法），命中区在 `app/design/v5-forms.css` 的接线层放大。
 */

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useI18n } from "@/hooks/useI18n";

export function PwaComposerSheet({
  open,
  title,
  label,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  /** `.m-sheet-title` 的内容（静态文案 → 真实数据）。 */
  title: ReactNode;
  /** 无障碍名；缺省用 title。 */
  label?: string;
  /** 点遮罩 / Esc 都走它（行为不变，仍由调用方自己的 state 决定）。 */
  onClose: () => void;
  children: ReactNode;
  /** 底部动作行（`.m-pickbar`）；省略即不渲染这一层。 */
  footer?: ReactNode;
}) {
  // portal 只能在挂载后落 document.body；SSR 与首帧不渲染，避免 hydration 不一致。
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const ready = open && mounted;
  const { dialogRef, dialogProps } = useDialogA11y({ open: ready, onClose });
  const { t } = useI18n();

  if (!ready) return null;

  return createPortal(
    <div
      ref={dialogRef}
      style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: "var(--nx-z-modal)" }}
    >
      <div className="m-scrim is-open" onClick={onClose} />
      <div
        {...dialogProps}
        className="m-sheet is-open"
        style={{ pointerEvents: "auto" }}
        aria-label={label}
      >
        <div className="m-sheet-title">{title}</div>
        <div className="m-sheet-body">{children}</div>
        {footer ? <div className="m-pickbar">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/**
 * `.m-sheet-row`：可点（`button`）与纯展示（`div`）两档。
 * `is-on` 是画板点名的互斥选中态（`.m-sheet-row.is-on` 自带 ✓）。
 * 形状取自 M-01 帧 C「一行一个模型」：图标 + `m-setrow-body`（标题 + 副行）+ 右侧件。
 *
 * fork:v5-landing E4 · `radio` —— 三张 PWA 板上的**互斥单选行**行尾不是 ✓，是
 * 一枚 `.m-radio`（`on` 是它的状态类）：M-01 帧 C 的模型 / 能力两栏、
 * M-05 帧 C 的权限三档、M-09 帧 A 的插件权限逐条。所以互斥清单（思考强度 /
 * 权限档位 / 模型）传 `radio` 走这一支，非互斥的清单（工具预设）维持 `.is-on` 的 ✓。
 */
export function PwaComposerSheetRow({
  icon,
  title,
  desc,
  on,
  onClick,
  trailing,
  disabled,
  ariaLabel,
  className,
  leading,
  descClass,
  radio,
}: {
  icon?: string;
  title: ReactNode;
  desc?: ReactNode;
  on?: boolean;
  onClick?: () => void;
  trailing?: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
  /** 0-2-0 之外的逃生口：`.m-menu-row` 这类同构行形（能力面板里的三档列表）。 */
  className?: string;
  /**
   * fork:v5-frame-audit —— 行首件（画板 M-03 帧 A 把 `.m-ring` 放在图标位，
   * 即行首而不是 trailing）。给了它就顶替 `.m-setrow-body` 之前的位置。
   */
  leading?: ReactNode;
  /**
   * 副行类名：能力 / 模型面板（画板 M-01 帧 C、M-03 帧 A）写 `.m-setrow-s`，
   * 补全面板（画板 M-03 帧 D-1、M-08）写 `.m-sheet-row-desc` —— 两个类都在
   * `pwa/system.css` 里，两处画板原文不同，所以这里由调用方按那块板指定。
   */
  descClass?: string;
  /**
   * 互斥单选行：行尾挂画板的 `.m-radio`（`on` → `.m-radio.on`），
   * 且**不再叠** `.is-on` 的 ✓ —— 画板上这两件从不共存，同一件事只由一个来源说。
   */
  radio?: boolean;
}) {
  const cls = className ?? "m-sheet-row";
  const descCls = descClass ?? "m-sheet-row-desc";
  const marked = radio === true;
  const body = (
    <>
      {leading}
      {icon ? <i data-ico={icon} data-size="16" aria-hidden="true" /> : null}
      <span className="m-setrow-body">
        <span className="m-setrow-t">{title}</span>
        {desc ? <span className={descCls}>{desc}</span> : null}
      </span>
      {trailing}
      {marked ? <span className={`m-radio${on ? " on" : ""}`} aria-hidden="true" /> : null}
    </>
  );
  if (!onClick) {
    return <div className={cls}>{body}</div>;
  }
  return (
    <button
      type="button"
      className={`${cls}${on && !marked ? " is-on" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={marked ? on : undefined}
    >
      {body}
    </button>
  );
}

/**
 * `.m-menu-row` + `.m-pop-foot`：浮层底部的说明行（M-03 帧 D-1「点一项即插入并收起」）。
 * 纯展示，不带交互。
 */
export function PwaPopFoot({ children }: { children: ReactNode }) {
  return <div className="m-pop-foot">{children}</div>;
}