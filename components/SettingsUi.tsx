"use client";

import { Fragment } from "react";
import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from "react";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useIsMobile } from "@/hooks/useIsMobile";

type ConfigButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ConfigButtonSize = "small" | "default";

interface ConfigPanelShellProps {
  embedded: boolean;
  title: string;
  subtitle?: string;
  closeLabel?: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  height?: string;
}

export function ConfigPanelShell({
  embedded,
  title,
  subtitle,
  closeLabel = "Close",
  onClose,
  children,
  width = 900,
  height = "78vh",
}: ConfigPanelShellProps) {
  const panelStyle = embedded
    ? undefined
    : ({
        "--config-panel-width": `${width}px`,
        "--config-panel-height": height,
      } as CSSProperties);

  // fork:dsn-dialog-a11y — 只有 modal 形态需要焦点约束；embedded 是页面内面板。
  // 补齐：打开移焦进弹层、Tab 在弹层内循环、Esc 关闭、兄弟节点 inert、关闭还原焦点。
  // 原先只有 role/aria-modal 两个属性，键盘用户 Tab 会走到弹层背后的侧栏。
  const { dialogRef, dialogProps } = useDialogA11y({ open: !embedded, onClose });

  return (
    <div
      ref={embedded ? undefined : dialogRef}
      role={embedded ? undefined : dialogProps.role}
      aria-modal={embedded ? undefined : dialogProps["aria-modal"]}
      aria-label={title}
      className={`config-panel-root ${embedded ? "is-embedded" : "is-modal"}`}
      onClick={(event) => {
        if (!embedded && event.target === event.currentTarget) onClose();
      }}
    >
      <div className="config-panel-surface" style={panelStyle}>
        {!embedded && (
          <div className="config-panel-header">
            <strong className="config-panel-title">{title}</strong>
            {subtitle && (
              <code className="config-panel-subtitle" title={subtitle}>
                {subtitle}
              </code>
            )}
            <button
              type="button"
              className="config-close-button"
              onClick={onClose}
              title={closeLabel}
              aria-label={closeLabel}
            >
              ×
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * fork:design-system SW-08~13 —— 列表 / 详情的结构基件。
 *
 * fork:v5-landing Wave B（M-05）—— **这一组基件现在按形态发两套类**：
 *   ≥641px 走 D-07 / D-07b 的 `d-*`，≤640px 走 M-05 的 `m-*`（`useIsMobile()`
 *   判定，与 `app/design/v5-forms.css` 的媒体条件是同一个 640px 断点）。
 * 旧的 `pw-*` 骨架（pw-cols / pw-list / pw-litem / pw-detail / pw-shead …）在本文件
 * 里**已清零**：它们是 `design/pi-web-design/assets/board.css`（v1 画板）的类，
 * 与 v5 两张形态表都不是同一来源，留着就是第二次「同一个视觉两个类名」。
 * board.css 里那些规则随之成为 stale，由 Wave Z 随旧样式统一清扫（§7.1 / §7.2）。
 *
 * 桌面（d-*）列位沿用 D-07 的设置壳解剖，两栏就是它：
 *   .d-set            flex 两列（d-modal-box > .d-set 弹窗里两列各自滚）
 *     .d-set-nav      左列 220px、发丝右边界、overflow-y:auto、gap 2px
 *     .d-set-main     右列 flex:1、overflow-y:auto
 * 手机（m-*）按 M-05 帧 B「一行一个控件」：左列塌成 `m-list`（唯一滚动列），
 * 行是 `m-trow`，详情塌成 `m-cardgroup`。
 *
 * 这里只发类名，不写任何颜色 / 尺寸 / 间距 / 圆角 —— 规格全部来自
 * `design/v5/web/system.css`（d-*）与 `design/v5/pwa/system.css`（m-*）。
 * ------------------------------------------------------------------------- */

export function ConfigSplitView({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  return <div className={isMobile ? "m-list" : "d-set"}>{children}</div>;
}

/** 左列。桌面 = D-07 的 `.d-set-nav`（220px 定宽 + 自身滚动）；手机 = 一个列容器，
 *  真正的行在 `ConfigSidebarList`（`m-cardgroup`）里。 */
export function ConfigSidebar({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  return <div className={isMobile ? "d-col" : "d-set-nav"}>{children}</div>;
}

export function ConfigSidebarList({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  return <div className={isMobile ? "m-cardgroup" : "d-col"}>{children}</div>;
}

/**
 * fork:group-switch（G4 · 上游 `b9622a1` #1021）—— 分组标题升级成**整组开关**的宿主。
 *
 * `aside` 是右端那一格。**右对齐的空格由调用方自己带**（画板里的 `d-grow`，
 * 归档面板与项目归档两处已经这么写）：标签本体的子节点一个字不动，所以既有
 * 调用点的排版与改前逐像素一致。技能页与插件页把
 * `n/m` + 开关交给 `ConfigSidebarGroupSwitch`（它自带右对齐用的 `d-grow`）。
 */
export function ConfigSidebarGroupLabel({
  children,
  aside,
}: {
  children: ReactNode;
  aside?: ReactNode;
}) {
  const isMobile = useIsMobile();
  return (
    <div className={isMobile ? "m-group-title" : "d-group-title"}>
      {children}
      {aside}
    </div>
  );
}

/**
 * 一组开关会改动**哪些行**：不在目标状态的那些。
 *
 * 关掉一组时 `keepOn` 点名的行被排除在外，交回调用方如实报出去，而不是悄悄改掉
 * —— 上游唯一用到它的地方是插件包：停用一个带 resource filter 的包会清空它的
 * 过滤条件（`app/api/plugins/route.ts:setPackageDisabled` 把 extensions/skills/
 * prompts/themes 都写成空数组），所以这种包在批量停用时保持启用，只能用它自己的
 * 开关处理。
 *
 * 纯函数，与上游 `components/settings-ui-helpers.ts` 的 `itemsToSwitch` 同语义；
 * 放在这里是因为技能分节与插件分节共用这一个模块（两边都已经 import SettingsUi）。
 */
export function itemsToSwitch<T>(
  items: readonly T[],
  enabled: boolean,
  isEnabled: (item: T) => boolean,
  keepOn?: (item: T) => boolean,
): T[] {
  return items.filter((item) => isEnabled(item) !== enabled && (enabled || !keepOn?.(item)));
}

/**
 * 一组开关：`n/m` 计数 + 开关。**只有全开才算开** —— 部分开的组读起来是「关」，
 * 点一下补齐（与模型页的供应商开关同一条口径，上游同款）。
 * 计数用画板已有的 `.d-mono` + `.d-t-faint`，开关是画板 `.d-switch`：
 * **不新造类**（判据⑦），也不缩到 `.d-trow` 行尾那种 0.8 倍的小尺寸
 * （上游 `4de9f77` 的结论：分组标题里的开关要画板原尺寸，才点得中）。
 * 开头的 `d-grow` 是标题与右端这一格之间的弹性空档（与归档面板里的写法同款）。
 */
export function ConfigSidebarGroupSwitch({
  enabled,
  total,
  label,
  disabled = false,
  loading = false,
  onChange,
}: {
  enabled: number;
  total: number;
  label: string;
  disabled?: boolean;
  loading?: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const isMobile = useIsMobile();
  return (
    <>
      <span className={isMobile ? "m-grow" : "d-grow"} aria-hidden="true" />
      <span className={isMobile ? "m-t-xs m-mono m-t-faint" : "d-t-xs d-mono d-t-faint"}>{`${enabled}/${total}`}</span>
      <ConfigSwitch
        checked={total > 0 && enabled === total}
        disabled={disabled}
        loading={loading}
        label={label}
        onChange={onChange}
      />
    </>
  );
}

/**
 * 一次分组开关**没做完的部分**，落在刚跑过的那一组标题下面：提示一行
 * （`.d-banner info` / M-05 的 `.m-banner`，如「带资源过滤的包保持启用」），
 * 被拒的行逐行列出（`.d-banner err`，`role="alert"`）。两行都是画板已有的样式类。
 * `errorLines` 用数组而不是一整段文本：提示条没有 `white-space` 规则，
 * 一整段里的换行会被折叠成一行。
 */
export function ConfigSidebarGroupStatus({
  note,
  errorLines,
}: {
  note?: ReactNode;
  errorLines?: readonly string[];
}) {
  // fork:react-hooks —— 早退必须在所有 hook 之后，否则同一组件在两次渲染里调用的
  // hook 数量不同（这行注释就是那条例外的登记处）。
  const isMobile = useIsMobile();
  if (!note && !errorLines?.length) return null;
  return (
    <>
      {note ? (
        <div role="status" className={isMobile ? "m-banner" : "d-banner info"}>
          <i data-ico="info" data-size="14" aria-hidden="true" />
          <span className={isMobile ? "m-grow" : "d-grow"}>{note}</span>
        </div>
      ) : null}
      {errorLines && errorLines.length > 0 ? (
        <div role="alert" className={isMobile ? "m-banner" : "d-banner err"}>
          <i data-ico="triangle-alert" data-size="14" aria-hidden="true" />
          <span className={isMobile ? "m-grow" : "d-grow"}>
            {errorLines.map((line, index) => (
              <Fragment key={`${index}:${line}`}>
                {index > 0 ? <br /> : null}
                {line}
              </Fragment>
            ))}
          </span>
        </div>
      ) : null}
    </>
  );
}

export function ConfigSidebarItem({
  active = false,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  const isMobile = useIsMobile();
  return (
    <button
      type="button"
      {...props}
      aria-current={active ? "page" : undefined}
      className={[
        isMobile ? "m-trow" : "d-trow",
        active ? "is-on" : "",
        className,
      ].filter(Boolean).join(" ")}
    >
      {children}
    </button>
  );
}

export function ConfigSidebarText({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  const isMobile = useIsMobile();
  return (
    <span
      {...props}
      className={[isMobile ? "m-setrow-t" : "d-t-sm d-t-b", className].filter(Boolean).join(" ")}
    />
  );
}
/** 列表行的副标题（画板 `.d-trow` 行里的次级一行：模型数、接口地址…）。 */
export function ConfigSidebarSub({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  const isMobile = useIsMobile();
  return (
    <span
      {...props}
      className={[isMobile ? "m-setrow-s" : "d-t-xs d-t-faint", className].filter(Boolean).join(" ")}
    />
  );
}

/** `.d-badge` / M-05 的 `.m-badge`：`tone` 对应 `.ok` / `.warn` / `.bad` / `.info` / `.mute`。 */
export function ConfigBadge({ tone, className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: string }) {
  const isMobile = useIsMobile();
  return <span {...props} className={[isMobile ? "m-badge" : "d-badge", tone ?? "", className ?? ""].filter(Boolean).join(" ")} />;
}

/** 画板 `.d-kv-row` 的纵向容器（v1 是 `.pw-kv`：140px 定宽的「标签 / 值」表）。 */
export function ConfigKv({ children, className, ...props }: HTMLAttributes<HTMLDListElement>) {
  return <dl {...props} className={["d-col", className ?? ""].filter(Boolean).join(" ")}>{children}</dl>;
}

/** 字段右侧的控件槽（桌面是 `.d-grow-last`，手机是 M-05 的 `.m-row-body` 行体）。 */
export function ConfigControl({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  const isMobile = useIsMobile();
  return <span {...props} className={[isMobile ? "m-row-body" : "d-grow-last", className ?? ""].filter(Boolean).join(" ")} />;
}

/** 画板 `.d-statgrid`：用量摘要四张小卡的网格（手机是 M-05 的 `.m-grid2`）。 */
export function ConfigStatGrid({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const isMobile = useIsMobile();
  return <div {...props} className={[isMobile ? "m-grid2" : "d-statgrid", className ?? ""].filter(Boolean).join(" ")}>{children}</div>;
}

/** 画板 `.d-stat`：一张用量小卡（`.d-t-xs` 标签 / `.d-t-lg` 数值 / 一行补充）。 */
export function ConfigStat({ label, value, hint }: { label: string; value: string; hint?: ReactNode }) {
  const isMobile = useIsMobile();
  return (
    <div className={isMobile ? "m-cardgroup" : "d-stat"}>
      <span className={isMobile ? "m-t-xs m-t-faint" : "d-t-xs"}>{label}</span>
      <span className={isMobile ? "m-t-lg m-t-b" : "d-t-lg"}>{value}</span>
      {hint ? <span className={isMobile ? "m-t-xs m-t-faint" : "d-t-xs d-t-faint"}>{hint}</span> : null}
    </div>
  );
}

/** 右列内容栈：桌面 = `.d-col`，手机同构。上一版的 inline `gap: var(--s3)` 已撤 ——
 *  间距是**角色值**，归 `system.css` 独占（铁律三 / 四）；空态居中改由
 *  `ConfigEmptyState` 自己的 `d-empty` / `m-empty` 负责（都是居中容器）。 */
export function ConfigDetailStack({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={["d-col", className].filter(Boolean).join(" ")} />;
}

export function ConfigDetailHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={["d-row", className].filter(Boolean).join(" ")}
    />
  );
}

export function ConfigDetailHeaderInfo({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={["d-col", "d-grow", className].filter(Boolean).join(" ")}
    />
  );
}

export function ConfigDetailActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={["d-row", className].filter(Boolean).join(" ")}
    />
  );
}

export function ConfigDetailTitle({ children }: { children: ReactNode }) {
  return <h3 className="d-set-row-t" style={{ margin: 0 }}>{children}</h3>;
}

export function ConfigSectionTitle({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  return (
    <div className={isMobile ? "m-group-title" : "d-set-sec-t"}>
      {children}
      <span className={isMobile ? "m-grow" : "d-grow"} aria-hidden="true" />
    </div>
  );
}

/** 字段行：桌面 = D-07 的 `.d-field`（`.d-field-t` 标题 + 控件），
 *  手机 = M-05 的 `div.m-setrow`（标题 + 副行 + 控件，44px 触控行）。
 *  画板纪律：带控件的行写成 `div` 而不是 `button`，避免 button 套 button。
 *  `hint` 走次级一行，不是右边的提示位。 */
export function ConfigField({ label, hint, children, style }: {
  label: ReactNode;
  hint?: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <div className="m-setrow">
        <span className="m-setrow-body">
          <span className="m-setrow-t">{label}</span>
          {hint ? <span className="m-setrow-s">{hint}</span> : null}
        </span>
        {children}
      </div>
    );
  }
  return (
    <div className="d-field" style={style}>
      <span className="d-field-t">
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
      {children}
    </div>
  );
}

export function ConfigEmptyState({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  // D-07b / M-05 的空态：内容区居中（图标 + 一句引导），颜色 / 内距 / 字号全部
  // 来自 `d-empty` / `m-empty`，这里不写内联。
  return <div className={isMobile ? "m-empty" : "d-empty"}>{children}</div>;
}

export function ConfigDetail({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const isMobile = useIsMobile();
  return (
    <div className={isMobile ? "m-cardgroup" : "d-card"} style={style}>
      {children}
    </div>
  );
}

export function ConfigFooter({ status, children }: { status?: ReactNode; children?: ReactNode }) {
  const isMobile = useIsMobile();
  return (
    <footer className={isMobile ? "m-sheet-foot" : "d-modal-foot"}>
      <span className={isMobile ? "m-t-xs m-mono m-t-faint" : "d-t-xs d-mono d-t-faint"}>{status}</span>
      <span className={isMobile ? "m-grow" : "d-grow"} aria-hidden="true" />
      <span className="d-row">{children}</span>
    </footer>
  );
}

/**
 * fork:design-system SW-08~13 —— 按钮：D-07 的 `.d-btn` 四态，M-05 的 `.m-btn`。
 *
 *   primary   → d-btn primary / m-btn（手机上 `.m-btn` 就是强调档）
 *   secondary → d-btn（发丝边框）/ m-btn
 *   ghost     → d-btn ghost / m-btn ghost
 *   danger    → d-btn danger / m-btn（手机上危险档用 `.m-picktag.danger`，
 *               见 M-04 删除确认；这里保持与桌面同一语义，只是没画 danger 变体）
 */
export function ConfigButton({
  variant = "secondary",
  size = "default",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ConfigButtonVariant; size?: ConfigButtonSize }) {
  const isMobile = useIsMobile();
  // 桌面 `.d-btn` 的次要档本来就是「发丝边框」本体，所以 secondary → 空类名；
  // `.m-btn` 同款（它也有 `.primary` / `.danger` / `.ghost`）。
  const variantClass = variant === "primary" ? "primary"
    : variant === "secondary" ? ""
    : variant === "danger" ? "danger"
    : "ghost";
  return (
    <button
      type="button"
      {...props}
      className={[
        isMobile ? "m-btn" : "d-btn",
        variantClass,
        size === "small" ? "sm" : "",
        className,
      ].filter(Boolean).join(" ")}
    >
      {children}
    </button>
  );
}

/** 开关：D-07 的 `<button class="d-switch on">`（34×20）/ M-05 的 `.m-switch`（48×29）。
 *  产品必须是可聚焦按钮，所以画板里那个静态 `<span>` 换成 `<button role="switch">`，
 *  类名与状态类一字不动。 */
export function ConfigSwitch({ checked, disabled = false, loading = false, label, onChange }: { checked: boolean; disabled?: boolean; loading?: boolean; label: string; onChange: (checked: boolean) => void }) {
  const isMobile = useIsMobile();
  const inactive = disabled || loading;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={loading || undefined}
      aria-label={label}
      title={label}
      disabled={inactive}
      className={`${isMobile ? "m-switch" : "d-switch"}${checked ? " on" : ""}${!isMobile && loading ? " is-loading" : ""}`}
      onClick={() => onChange(!checked)}
    />
  );
}

/** 列表底部的「新增一行」：列里的一条 `.d-trow` / `.m-trow` + 前置 plus 图标。 */
export function ConfigListAction({ active = false, children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  const isMobile = useIsMobile();
  return (
    <button
      type="button"
      {...props}
      aria-current={active ? "page" : undefined}
      className={[isMobile ? "m-trow" : "d-trow", className].filter(Boolean).join(" ")}
    >
      <i data-ico="plus" data-size="14" aria-hidden="true"></i>
      <span className={isMobile ? "m-grow" : "d-grow"}>{children}</span>
    </button>
  );
}

export function ConfigStatusDot({ active, color }: { active?: boolean; color?: string }) {
  const isMobile = useIsMobile();
  // v1 的 `.pw-dot.pending` 在 v5 表里叫 `.warn`（画板 `.d-dot` / `.m-dot` 都有）。
  const state = active ? " run" : active === false ? " warn" : "";
  return (
    <span
      aria-hidden="true"
      className={`${isMobile ? "m-dot" : "d-dot"}${state}`}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

/* ---------------------------------------------------------------------------
 * fork:zn-15 退役（2026-10-01 孤儿清理）—— Zeno 形态的 `SettingsBlock` /
 * `SettingsRow` / `SettingsSlider` 三个基件及其 `.fork-settings-*` 样式已删除：
 * 全仓零引用，分节已全部迁到下面的设置行基件。「标题在上、控件在右上」的行形态
 * 在画板里没有对应物，不再保留第二套设置行。
 * ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * fork:design-system SW-07 / fork:v5-landing Wave B —— 设置控件基件。
 *
 * 桌面：D-07 把设置页定成「`.d-set-nav` 左导航 + `.d-set-main` 右内容」两栏，
 * 内容由 `.d-set-sec`（分组，标题带 14px 图标）与 `.d-set-row`（左标签 + 一句
 * 小字说明 + 右控件）拼成。
 * 手机：M-05 把设置页定成两层（hub 卡片 → 分节二级页），内容由 `.m-cardgroup`
 * （白卡）+ `div.m-setrow`（44px 触控行）拼成。
 *
 * 这一组基件只发类名，规格全部来自 `design/v5/web/system.css` 与
 * `design/v5/pwa/system.css` —— 这里不写任何颜色 / 尺寸 / 间距 / 圆角。
 * （fork:zn-15 的 Zeno 形态行已退役，见上方退役说明：这是唯一的设置行形态。）
 * ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * fork:settings-frame —— 设置页三件套。
 *
 * 分节原来有 4 种骨架（单列块流 / 列表+详情 / 顶部整宽条+两栏 /
 * 块流+底部两栏），现在统一成：
 *
 *   页头（标题 + sub + 页级动作）  ── 恒在
 *   工具栏（搜索 + 筛选 + 计数 + 列表级动作）── 有列表才有
 *   内容区 ── 唯一滚动容器
 *
 * 三个块是**分节宿主的直接子元素**，不另包一层：宿主本身已经是 flex column
 * （`.settings-section-host` 或 `.config-panel-surface`）。所以这里返回 Fragment，
 * 而不是一层 wrapper —— 多一层会让 `height:100%` 的传递断掉。
 *
 * `fill` 给列表页用：内容区不滚，交给两列各自滚（`.d-set-nav` 自带
 * `overflow-y: auto`）。手机端（M-05 帧 B）不分这两层 —— 二级页只有一块内容流。
 * ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * 页级动作的契约（画板 62「动作四级归位」①：页级 · 页头右端）
 *
 * 页级动作**只走 `actions` 这一个口**。右对齐不另加 margin —— 是标题那格的
 * `.d-grow` 把右槽顶出去的。层级不许混：
 *   ① 页级   → actions（页头右端，最多 2 个：1 主 1 次）
 *   ② 列表级 → toolbar（与计数徽章同排）
 *   ③ 条目级 → ConfigDetailActions（详情头右端）
 *   ④ 表单级 → 表单块底部右对齐（绝不浮在视口右下角）
 *   页脚     → 只放只读状态，且必须是本页自己的（画板 62 帧 D）
 *
 * **`actions` 省略时这个槽整个不出现在 DOM 里，这是对的。** 不要为了「让某一帧
 * 量得到」而渲染一个空的右槽：「改动即时生效、不需要保存」这句话产品的页头 sub
 * 已经说了（`settings.generalSub`）。
 * ------------------------------------------------------------------------- */

export function SettingsPage({
  title,
  sub,
  actions,
  toolbar,
  fill = false,
  children,
}: {
  title: string;
  /** 一句「这页是干嘛的」。**不写数据** —— 计数进工具栏的等宽徽章。 */
  sub?: string;
  /** 页级动作，最多 2 个（1 primary + 1 outline），永远在页头右端。
   *  省略即**不渲染**右槽 —— 空槽不是缺陷（见上方契约说明）。 */
  actions?: ReactNode;
  /** 列表级动作与搜索行；省略即不出工具栏。 */
  toolbar?: ReactNode;
  fill?: boolean;
  children: ReactNode;
}) {
  const isMobile = useIsMobile();
  // 手机（M-05 帧 B）：分节二级页的页头就是 `.m-hero`（标题 + 一句说明），
  // 动作与工具栏各自落进一张 `.m-cardgroup` / 一行 `.m-fieldrow`，
  // 绝不另起一块左导航 —— 二级页左上角永远能直接回 hub。
  if (isMobile) {
    return (
      <>
        <div className="m-hero">
          <span className="m-t-lg m-t-b">{title}</span>
          {sub ? <span className="m-t-cap m-t-dim">{sub}</span> : null}
        </div>
        {toolbar ? <div className="m-cardgroup m-fieldrow">{toolbar}</div> : null}
        {actions ? <div className="m-cardgroup m-fieldrow">{actions}</div> : null}
        {children}
      </>
    );
  }
  // 桌面（D-07 / D-07b）：设置壳里没有独立页头类 —— 分节标题就是一块
  // `.d-set-sec`，标题 `.d-set-sec-t`、副标题一行弱化说明、动作在标题行右端。
  // `fill` 给列表 + 详情那几节：内容区就是 D-07 的两栏壳（`.d-set`），左列
  // `.d-set-nav` 自带 `overflow-y: auto`；其余分节是单列块流（`.d-col`）。
  // 手机（M-05 帧 B）只有一块内容流，两栏在 `ConfigSplitView` 里自己塌成一列。
  return (
    <>
      <div className="d-set-sec">
        <div className="d-row">
          <span className="d-t-lg d-t-b d-grow">{title}</span>
          {/* ① 页级动作（动作四级归位 ①）：右端对齐由 `.d-grow` 顶出，不另加 margin。 */}
          {actions ? <div className="d-row">{actions}</div> : null}
        </div>
        {sub ? <div className="d-t-xs d-t-faint">{sub}</div> : null}
      </div>
      {toolbar ? <div className="d-row">{toolbar}</div> : null}
      <div className={fill ? "d-set" : "d-col"}>{children}</div>
    </>
  );
}

/** 工具栏里的搜索框：D-07 的 `.d-searchfield` / M-05 的 `.m-searchfield`。 */
export function PwSearch({
  value,
  placeholder,
  ariaLabel,
  onChange,
}: {
  value: string;
  placeholder: string;
  ariaLabel: string;
  onChange: (next: string) => void;
}) {
  const isMobile = useIsMobile();
  return (
    <span className={isMobile ? "m-searchfield m-grow" : "d-searchfield"}>
      <i data-ico="search" data-size="14" aria-hidden="true" />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        maxLength={60}
        onChange={(event) => onChange(event.target.value)}
      />
    </span>
  );
}


/** 分组块：桌面 = 画板 D-07 的 `.d-set-sec` + `.d-set-sec-t`（图标进标题行）；
 *  手机 = M-05 帧 C 的 `.m-cardgroup`（白卡）+ 卡内 `.m-group-title`。
 *  两边都是「一块标题 + 若干行」，行的形态由 `PwField` 按形态发 `d-set-row` /
 *  `m-setrow`。 */
export function PwBlock({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <div className="m-cardgroup">
        <div className="m-group-title">
          <i data-ico={icon} data-size="14" aria-hidden="true" />
          {title}
        </div>
        {children}
      </div>
    );
  }
  return (
    <div className="d-set-sec">
      <div className="d-set-sec-t">
        <i data-ico={icon} data-size="14" aria-hidden="true" />
        {title}
      </div>
      {children}
    </div>
  );
}

/**
 * 设置行：桌面 = D-07 的 `.d-set-row`（左「标题 + 小字说明」、右控件）；
 * 手机 = M-05 帧 B 的 `div.m-setrow`（`.m-setrow-body` 里标题在上、说明在下，
 * 控件在同一行右端 —— 44px 触控行）。
 *
 * `htmlFor` 给了就把标签包成真 `<label>`（点标签能聚焦到控件）；没给就只是文本。
 */
export function PwField({
  label,
  hint,
  htmlFor,
  control,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  control: ReactNode;
}) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <div className="m-setrow">
        <span className="m-setrow-body">
          <span className="m-setrow-t">
            {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}
          </span>
          {hint ? <span className="m-setrow-s">{hint}</span> : null}
        </span>
        {control}
      </div>
    );
  }
  return (
    <div className="d-set-row">
      <div className="d-set-row-box">
        <div className="d-set-row-t">
          {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}
        </div>
        {hint ? <div className="d-set-row-s">{hint}</div> : null}
      </div>
      <span className="d-grow-last">{control}</span>
    </div>
  );
}

/** 行内控件组：桌面 = D-07 的 `.d-row`（flex、gap s2）；手机 = M-05 的 `.m-row-body`
 *  （flex:1 + min-width:0，让 44px 控件组在 44 高的触控行里自己占满右半格）。 */
export function PwCtl({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  return <span className={isMobile ? "m-row-body" : "d-row"}>{children}</span>;
}

/** 等宽数字读数：D-07 的 `.d-t-xs.d-mono` / M-05 的 `.m-t-xs.m-mono`。 */
export function PwValue({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  return <span className={isMobile ? "m-t-xs m-mono" : "d-t-xs d-mono"}>{children}</span>;
}

/**
 * 开关：D-07 是 `<button class="d-switch on">`（34×20），M-05 是 `.m-switch`（48×29）。
 * 产品必须是可聚焦按钮，所以画板里那个静态元素换成 `<button role="switch">`，
 * 类名与状态类一字不动。
 */
export function PwSwitch({
  checked,
  disabled = false,
  loading = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  loading?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  const isMobile = useIsMobile();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={loading || undefined}
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      className={`${isMobile ? "m-switch" : "d-switch"}${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
    />
  );
}

export interface PwRadioOption<T extends string> {
  value: T;
  label: string;
  /** data-ico 图标名（画板 sprite）。 */
  icon?: string;
  /** 画板的 radio 芯片可带前置图标；产品的芯片还要放**非 sprite 名**的图案
   *  （画板 D-08 · 模型设置的图标模式选择放的是品牌 ProviderIcon），所以允许直接传
   *  节点；与 `icon` 同时给时 `node` 优先。 */
  node?: ReactNode;
  /** 原生 title 提示（如 LimitChips 芯片上的原始数值）。 */
  title?: string;
}

/**
 * 单选芯片组：桌面 = D-07 的 `.d-seg > button`（内嵌分段，选中 `.is-on`）；
 * 手机 = M-05 帧 B 的 `div.m-pickbar > button.m-picktag`（等宽三档、44 高、
 * 选中即染色）。产品用 `<button role="radio">`（键盘可切换），状态类照抄。
 *
 * **什么时候是 `PwRadio`、什么时候是 `PwSelectBox`**（判据见下）：
 *   - `PwRadio`：**少量互斥、且要一眼看全**的档位。常规页四组 —— 主题
 *     （浅色 / 深色 / 跟随系统，带 sun / moon / monitor 图标）、界面语言
 *     （简体中文 / 繁體中文 / English，与 `lib/i18n/registry.ts` 的三个 locale
 *     一一对应）、界面密度（紧凑 / 标准 / 宽松）、过程步骤默认展开
 *     （推理 / 命令 / 工具 —— 产品语义是三个**独立**开关，所以那一组是
 *     `aria-pressed` 而不是 role=radio）。列表页一组 —— 技能页
 *     工具栏的作用域筛选（全部 / 项目 / 全局 / 路径）。
 *   - `PwSelectBox`：**值本身是一串要背下来的标识、或选项多到芯片排不下**的字段
 *     —— UI 字体（字体栈）、UI 字号 / 聊天字号 / 扩展字号、会话命名用的模型、
 *     子代理的保存作用域与思考强度、MCP 的传输方式与来源、壁纸的适配方式与遮罩。
 *   - 判据不是「几个选项」而是「值的性质」：芯片宽度跟着文案走，选项一多就把
 *     字段行顶破；下拉是定宽盒，值再长也不变形。**新加字段先按这条判，别一律下拉。**
 */
export function PwRadio<T extends string>({
  value,
  options,
  ariaLabel,
  disabled = false,
  onChange,
}: {
  value: T;
  options: readonly PwRadioOption<T>[];
  ariaLabel: string;
  disabled?: boolean;
  onChange: (next: T) => void;
}) {
  const isMobile = useIsMobile();
  return (
    <span
      className={isMobile ? "m-pickbar" : "d-seg"}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            title={option.title}
            disabled={disabled}
            className={isMobile
              ? `m-picktag${on ? " is-on" : ""}`
              : on ? "is-on" : undefined}
            onClick={() => onChange(option.value)}
          >
            {option.node
              ? option.node
              : option.icon
                ? <i data-ico={option.icon} data-size="12" aria-hidden="true" />
                : null}
            {option.label}
          </button>
        );
      })}
    </span>
  );
}

/**
 * 下拉：D-07 的 `.d-select` 与 M-05 的 `.m-select` 都是「静态盒 + chevron」，
 * 产品是原生 `<select>` 挂同一个类（原生外观由接线层 `appearance: none` 归零，
 * 登记为设计侧缺口）。
 */
export function PwSelectBox({
  value,
  options,
  ariaLabel,
  disabled = false,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  ariaLabel: string;
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  const isMobile = useIsMobile();
  return (
    <select className={isMobile ? "m-select" : "d-select"} value={value} aria-label={ariaLabel} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

/**
 * 数值滑块：桌面 = D-07 的 `.d-slider` + `.d-t-xs.d-mono` 读数；
 * 手机 = M-05 帧 B 的 `.m-slider`（拇指 26px）+ `.m-t-xs.m-mono` 读数。
 */
export function PwRange({
  id,
  value,
  displayValue,
  min,
  max,
  step = 1,
  ariaLabel,
  disabled = false,
  onChange,
}: {
  id: string;
  value: number;
  displayValue: string;
  min: number;
  max: number;
  step?: number;
  ariaLabel: string;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  const isMobile = useIsMobile();
  return (
    <>
      <input
        id={id}
        className={isMobile ? "m-slider m-grow" : "d-slider"}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-valuetext={displayValue}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <PwValue>{displayValue}</PwValue>
    </>
  );
}
