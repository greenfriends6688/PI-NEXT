"use client";

import { Fragment } from "react";
import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from "react";
import { useDialogA11y } from "@/hooks/useDialogA11y";

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
 * fork:design-system SW-08~13 —— 列表 / 详情的结构基件换成画板类。
 *
 * 画板（41/42/43/44/46）的两栏结构是：
 *   .pw-cols            grid 260px + 1fr，gap s4
 *     > div             左列：.pw-inline（搜索行）+ .pw-list
 *         .pw-list      grid gap 2px
 *           .pw-litem   行（.is-on 选中）> .pw-ico + .grow(.pw-lname/.pw-lsub) + .pw-badge
 *     > div             右列：display:grid; gap s3
 *         .pw-detail    发丝边框卡 > h3 + .pw-kv / .pw-field / .pw-stats-grid
 *
 * 这里只换类名，不改结构；产品专属的语义（列不参与收缩、窄屏叠成一列）在
 * fork-ui.css 的接线块里，不重复画板已有的任何颜色/尺寸/间距。
 * ------------------------------------------------------------------------- */

export function ConfigSplitView({ children }: { children: ReactNode }) {
  return <div className="pw-cols">{children}</div>;
}

/** 左列：画板里就是一个裸 `<div>`（列宽由 `.pw-cols` 的 grid 决定，自己不带类）。
 *  产品要按结构选中它，走 `.pw-cols > :first-child`（见 fork-ui.css 接线块）。 */
export function ConfigSidebar({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}

export function ConfigSidebarList({ children }: { children: ReactNode }) {
  return <div className="pw-list">{children}</div>;
}

/**
 * fork:group-switch（G4 · 上游 `b9622a1` #1021）—— 分组标题升级成**整组开关**的宿主。
 *
 * `aside` 是右端那一格。**右对齐的空格由调用方自己带**（画板里的 `pw-grow`，
 * 归档面板与项目归档两处已经这么写）：标签本体的子节点一个字不动，所以既有
 * 调用点的排版与改前逐像素一致。技能页与插件页把
 * `n/m` + 开关交给 `ConfigSidebarGroupSwitch`（它自带右对齐用的 `pw-grow`）。
 */
export function ConfigSidebarGroupLabel({
  children,
  aside,
}: {
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="pw-group-title">
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
 * 计数用画板已有的 `.pw-mono` + `.pw-dim`，开关是画板 `.pw-switch`：
 * **不新造类**（判据⑦），也不缩到 `.pw-litem` 行尾那种 0.8 倍的小尺寸
 * （上游 `4de9f77` 的结论：分组标题里的开关要画板原尺寸，30×17 才点得中）。
 * 开头的 `pw-grow` 是标题与右端这一格之间的弹性空档（与归档面板里的写法同款）。
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
  return (
    <>
      <span className="pw-grow" aria-hidden="true" />
      <span className="pw-mono pw-dim">{`${enabled}/${total}`}</span>
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
 * （`.pw-alert info`，如「带资源过滤的包保持启用」），被拒的行逐行列出
 * （`.pw-alert`，`role="alert"`）。两行都是画板已有的样式类。
 * `errorLines` 用数组而不是一整段文本：`.pw-alert` 没有 `white-space` 规则，
 * 一整段里的换行会被折叠成一行。
 */
export function ConfigSidebarGroupStatus({
  note,
  errorLines,
}: {
  note?: ReactNode;
  errorLines?: readonly string[];
}) {
  if (!note && !errorLines?.length) return null;
  return (
    <>
      {note ? (
        <div role="status" className="pw-alert info">
          <span className="pw-ico"><i data-ico="info" data-size="13" aria-hidden="true" /></span>
          <span className="pw-grow">{note}</span>
        </div>
      ) : null}
      {errorLines && errorLines.length > 0 ? (
        <div role="alert" className="pw-alert">
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="13" aria-hidden="true" /></span>
          <span className="pw-grow">
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
  return (
    <button
      type="button"
      {...props}
      aria-current={active ? "page" : undefined}
      className={["pw-litem", active ? "is-on" : "", className].filter(Boolean).join(" ")}
    >
      {children}
    </button>
  );
}

export function ConfigSidebarText({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...props}
      className={["pw-lname", className].filter(Boolean).join(" ")}
    />
  );
}
/** 列表行的副标题（画板 `.pw-litem` 里的 `.pw-lsub`：模型数、接口地址…）。 */
export function ConfigSidebarSub({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} className={["pw-lsub", className].filter(Boolean).join(" ")} />;
}

/** 画板 `.pw-badge`：`tone` 对应 `.ok` / `.warn` / `.bad` / `.accent` / `.count` / `.solid`。 */
export function ConfigBadge({ tone, className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: string }) {
  return <span {...props} className={["pw-badge", tone ?? "", className ?? ""].filter(Boolean).join(" ")} />;
}

/** 画板 `.pw-kv`：140px 定宽的「标签 / 值」表（供应商详情的接口地址、认证方式…）。 */
export function ConfigKv({ children, className, ...props }: HTMLAttributes<HTMLDListElement>) {
  return <dl {...props} className={["pw-kv", className ?? ""].filter(Boolean).join(" ")}>{children}</dl>;
}

/** 画板 `.pw-ctl`：字段右侧的控件槽（自带 `flex: none`，标签左、控件右）。 */
export function ConfigControl({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} className={["pw-ctl", className ?? ""].filter(Boolean).join(" ")} />;
}

/** 画板 `.pw-stats-grid`：用量摘要四张小卡的网格。 */
export function ConfigStatGrid({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={["pw-stats-grid", className ?? ""].filter(Boolean).join(" ")}>{children}</div>;
}

/** 画板 `.pw-stat`：一张用量小卡（`.k` 标签 / `.v` 数值 / `.s` 一行补充）。 */
export function ConfigStat({ label, value, hint }: { label: string; value: string; hint?: ReactNode }) {
  return (
    <div className="pw-stat">
      <span className="k">{label}</span>
      <span className="v">{value}</span>
      {hint ? <span className="s">{hint}</span> : null}
    </div>
  );
}

/** 右列：画板是 `style="display:grid;gap:var(--s3)"` 的容器（不是卡）。
 *  原样照抄那行 inline —— 它就是画板 DOM 的一部分，不是产品自创的样式。
 *  fork:settings-frame（画板 62）—— 补一个 `.pw-detail-stack` 钩子类：
 *  详情卡改成 flex 列后，这一层要 `flex:1` 才能把高度传给空态（见 board.css）。
 *  fork:stack-rows（2026-10-01）—— 这一层拿到的是**确定高度**（board.css:874 的
 *  `flex:1` 让空态能垂直居中）。grid 的行默认 `auto`= 按内容分配比例，于是有实内容时
 *  行会被拉伸：归档项目详情里「标题行」被撑到 78px、「会话列表」被撑到 754px（里面只有
 *  2 行），会话行被推到卡片底部 —— 用户实测「右侧空白太多」。
 *  行改 `min-content`：实内容按内容高排列、贴顶；空态那一层自己 `height:100%`
 *  （board.css:876）继续在整卡高度里居中 —— 两种形态各归其位。 */
export function ConfigDetailStack({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    // fork:stack-rows（2026-10-01）—— display 与行高策略都交给 board.css
    // （`.pw-detail > .pw-detail-stack` 及它的 `:has(> .pw-empty:only-child)` 变体：
    // 有内容时 grid + `min-content` + `align-content:start` 让行贴顶；
    // 只有空态时那层变 flex、空态 `flex:1` 居中）。
    // 这里**不写内联 display/grid-***：内联优先级高于类规则，会把 `:has` 那条变体顶掉
    // （实测 `display` 仍是 grid、`flex:1` 生效但父不是 flex 列 → 空态仍 180px）。
    <div
      {...props}
      style={{ gap: "var(--s3)", ...props.style }}
      className={["pw-detail-stack", className].filter(Boolean).join(" ")}
    />
  );
}

export function ConfigDetailHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={["pw-inline", className].filter(Boolean).join(" ")}
    />
  );
}

export function ConfigDetailHeaderInfo({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={["pw-inline", "pw-grow", className].filter(Boolean).join(" ")}
    />
  );
}

export function ConfigDetailActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={["pw-inline", className].filter(Boolean).join(" ")}
    />
  );
}

export function ConfigDetailTitle({ children }: { children: ReactNode }) {
  return <h3 style={{ margin: 0 }}>{children}</h3>;
}

export function ConfigSectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="pw-sec-title">
      {children}
      <span className="pw-grow" aria-hidden="true" />
    </div>
  );
}

/** 画板 `.pw-field`：左「标签（+ `<small>` 一句说明）」、右控件。
 *  `hint` 走画板的 `.pw-label small`（弱化说明），不是右边的 `.pw-hint`。 */
export function ConfigField({ label, hint, children, style }: {
  label: ReactNode;
  hint?: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className="pw-field" style={style}>
      <span className="pw-label">
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
      {children}
    </div>
  );
}

export function ConfigEmptyState({ children }: { children: ReactNode }) {
  return (
    // fork:stack-rows（2026-10-01）—— 画板 62 帧 D「整页空」写明：**内容区居中**（40px 方框
    // 图标 + 一句引导居中，判据原话「说明写在空态里，不要飘到别处」）。
    //
    // 居中不再靠 `height:100%` 撑父行 —— 「父行被拉满」与「有内容的行贴顶」是互斥的
    // （board.css 的 `.pw-detail > .pw-detail-stack:has(> .pw-empty:only-child)` 用
    // `:has` 把这两种形态分开：空态时那层变 flex、空态 `flex:1`；有内容时保持 grid 贴顶）。
    // 颜色/内距/字号全由 board.css 的 `.pw-empty` / `.pw-empty-inner` 给，这里不写内联。
    <div className="pw-empty">
      <div className="pw-empty-inner">{children}</div>
    </div>
  );
}

export function ConfigDetail({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="pw-detail" style={style}>
      {children}
    </div>
  );
}

export function ConfigFooter({ status, children }: { status?: ReactNode; children?: ReactNode }) {
  return (
    <footer className="pw-modal-foot">
      <span className="pw-mono pw-dim">{status}</span>
      <span className="pw-grow" aria-hidden="true" />
      <span className="pw-inline">{children}</span>
    </footer>
  );
}

/**
 * fork:design-system SW-08~13 —— 按钮换成画板 00 的 `.pw-btn` 四态。
 *
 * 画板只有三种形态：默认（ghost，悬浮出 6% 底）、`.primary`（强调色填充）、
 * `.outline`（发丝边框 + 画布底）、`.danger`（error 文字），外加 `.sm` 一档尺寸。
 * 产品的四个变体照此映射：
 *   primary   → pw-btn primary
 *   secondary → pw-btn outline      （有边界的次要动作）
 *   ghost     → pw-btn              （无边界）
 *   danger    → pw-btn danger
 */
export function ConfigButton({
  variant = "secondary",
  size = "default",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ConfigButtonVariant; size?: ConfigButtonSize }) {
  const variantClass = variant === "primary" ? "primary"
    : variant === "secondary" ? "outline"
    : variant === "danger" ? "danger"
    : "";
  return (
    <button
      type="button"
      {...props}
      className={["pw-btn", variantClass, size === "small" ? "sm" : "", className].filter(Boolean).join(" ")}
    >
      {children}
    </button>
  );
}

/** fork:design-system SW-08~13 —— 开关 = 画板 00 的 `.pw-switch`（`<i>` 是圆钮）。 */
export function ConfigSwitch({ checked, disabled = false, loading = false, label, onChange }: { checked: boolean; disabled?: boolean; loading?: boolean; label: string; onChange: (checked: boolean) => void }) {
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
      className={`pw-switch${checked ? " on" : ""}${loading ? " is-loading" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <i aria-hidden="true" />
    </button>
  );
}

/** 列表底部的「新增一行」：画板是 `.pw-list` 里的一条 `.pw-litem` + 前置 plus 图标。 */
export function ConfigListAction({ active = false, children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      aria-current={active ? "page" : undefined}
      className={["pw-litem", "pw-litem-add", className].filter(Boolean).join(" ")}
    >
      <span className="pw-ico"><i data-ico="plus" data-size="13"></i></span>
      <span className="grow">{children}</span>
    </button>
  );
}

export function ConfigStatusDot({ active, color }: { active?: boolean; color?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`pw-dot${active ? " run" : active === false ? " pending" : ""}`}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

/* ---------------------------------------------------------------------------
 * fork:zn-15 退役（2026-10-01 孤儿清理）—— Zeno 形态的 `SettingsBlock` /
 * `SettingsRow` / `SettingsSlider` 三个基件及其 `.fork-settings-*` 样式已删除：
 * 全仓零引用，分节已全部迁到画板 40/62 的 `.pw-block` / `.pw-field` 行规格
 * （下面那组 pw-* 基件）。「标题在上、控件在右上」的行形态在画板里没有对应物，
 * 不再保留第二套设置行。
 * ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * fork:design-system SW-07 — 画板 40 的设置控件基件（pw-* 版）。
 *
 * 画板 40 把设置页定成「pw-snav 左导航 + pw-sbody 右内容」两栏，内容由
 * `pw-block`（发丝边框卡片，标题带 14px 图标）与 `pw-field`（标签可带一句小字 +
 * 右侧控件，行高 34、行间发丝线）拼成。这一组基件只做结构，规格全部来自
 * `design/pi-web-design/assets/board.css` —— 这里不写任何颜色 / 尺寸 / 间距。
 * （fork:zn-15 的 Zeno 形态行已退役，见上方退役说明：这是唯一的设置行形态。）
 * ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * fork:settings-frame（画板 62）—— 设置页三件套。
 *
 * 12 个分节原来有 4 种骨架（单列块流 / 列表+详情 / 顶部整宽条+两栏 /
 * 块流+底部两栏），页头只有 5 页有、4 页的 h2 还被包在 wrapper 里够不到
 * `board.css` 的 `> h2`。现在统一成：
 *
 *   页头（h2 + sub + 页级动作）  ── 恒在
 *   工具栏（搜索 + 筛选 + 计数 + 列表级动作）── 有列表才有
 *   内容区 ── 唯一滚动容器
 *
 * 三个块是**分节宿主的直接子元素**，不另包一层：宿主本身已经是 flex column
 * （块流页是 `.settings-section-host`，列表页是 `.config-panel-surface`）。
 * 所以这里返回 Fragment，而不是一个 wrapper —— 多一层会让 `height:100%`
 * 的传递断掉。
 *
 * `fill` 给列表页用：内容区不滚，交给 `.pw-cols` 的两列各自滚
 * （画板 62 帧 B「唯一滚动在内容区」的列表页形态）。
 * ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * `.pw-shead-acts` 的契约（画板 62「动作四级归位」①：页级 · 页头右端）
 *
 * 页级动作**只走 `actions` 这一个口**，类名照画板 62 帧 B（board.css:696：
 * `flex: none` + `gap: var(--s2)`）。右对齐不另加 margin —— 是
 * `.pw-shead-copy { flex: 1; min-width: 0 }` 把右槽顶出去的。层级不许混：
 *   ① 页级   → actions（页头右端，最多 2 个：1 主 1 次）
 *   ② 列表级 → toolbar（与计数徽章同排）
 *   ③ 条目级 → ConfigDetailActions（详情头右端）
 *   ④ 表单级 → 表单块底部右对齐（绝不浮在视口右下角）
 *   页脚     → 只放只读状态，且必须是本页自己的（画板 62 帧 D）
 *
 * **`actions` 省略时这个槽整个不出现在 DOM 里，这是对的。** 不要为了「让某一帧
 * 量得到」而渲染一个空的 `.pw-shead-acts`：画板 62 帧 E 的 12 分节落位表把
 * **常规 / 归档历史**（模型页按画板 41 的 DOM 裁定另算）的「页级动作」一栏写成
 * 「—」；帧 2 之所以在 `.pw-shead-acts` 里塞一枚 `无页级动作 · 即时生效` 徽章，
 * 是样张为了把页头三段式（copy + 右槽）画全而**自己加的批注**，不是产品要出的
 * 东西 —— 「改动即时生效、不需要保存」这句话产品的页头 sub 已经说了
 * （`settings.generalSub`）。`scripts/board-specs/62-frame2.mjs` 该把
 * `.pw-shead-acts` 登记成已知分歧，而不是让产品去补一枚空槽。
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
   *  省略即**不渲染** `.pw-shead-acts` —— 画板 62 帧 E 的落位表把常规 / 归档历史
   *  这一栏写成「—」，空槽不是缺陷（见上方契约说明）。 */
  actions?: ReactNode;
  /** 列表级动作与搜索行；省略即不出工具栏。 */
  toolbar?: ReactNode;
  fill?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <header className="pw-shead">
        <div className="pw-shead-copy">
          <h2>{title}</h2>
          {sub ? <p className="sub">{sub}</p> : null}
        </div>
        {/* ① 页级动作（动作四级归位 ①）：画板 62 帧 B 的类，右对齐由
            `.pw-shead-copy{flex:1}` 顶出，不另加 margin。见上方契约。 */}
        {actions ? <div className="pw-shead-acts">{actions}</div> : null}
      </header>
      {toolbar ? <div className="pw-stools">{toolbar}</div> : null}
      <div className={fill ? "pw-scontent is-fixed" : "pw-scontent"}>{children}</div>
    </>
  );
}

/** 工具栏里的搜索框（画板 62 帧 B 的 ②）：240 宽、24 高、带前置放大镜。 */
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
  return (
    <span className="pw-search">
      <span className="pw-ico pw-dim"><i data-ico="search" data-size="14" aria-hidden="true" /></span>
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


/** 分组卡：`pw-block` + 带图标的 `h3`。 */
export function PwBlock({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <div className="pw-block">
      <h3>
        <span className="pw-ico"><i data-ico={icon} data-size="14"></i></span>
        {title}
      </h3>
      {children}
    </div>
  );
}

/**
 * 设置行：`pw-field` = 左「标签（+ 小字说明）」、右「控件」。
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
  return (
    <div className="pw-field">
      <span className="pw-label">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}
        {hint ? <small>{hint}</small> : null}
      </span>
      {control}
    </div>
  );
}

/** 行内控件组：`pw-ctl`（右对齐、flex、gap s2）。 */
export function PwCtl({ children }: { children: ReactNode }) {
  return <span className="pw-ctl">{children}</span>;
}

/** 等宽数字读数（画板 40 里宽度 / 字号 / 浓度都是这个形态）。
 *  画板这两处是一次性 inline `font-size:var(--text-meta)`；`.pw-mono`（board.css:65）
 *  本身就是 `var(--text-meta)`，`.pw-dim` 把它压到 placeholder 色 —— 不需要 inline。 */
export function PwValue({ children }: { children: ReactNode }) {
  return <span className="pw-mono pw-dim">{children}</span>;
}

/**
 * 开关：画板是 `<span class="pw-switch on"><i></i></span>`，产品必须是可聚焦按钮，
 * 所以换成 `<button role="switch">` 并保留同一组类；UA 归零在 fork-ui.css 的接线块。
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
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={loading || undefined}
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      className={`pw-switch${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <i aria-hidden="true" />
    </button>
  );
}

export interface PwRadioOption<T extends string> {
  value: T;
  label: string;
  /** data-ico 图标名（画板 sprite）。 */
  icon?: string;
  /** 画板的 radio 芯片可带前置 `pw-ico`；产品的芯片还要放**非 sprite 名**的图案
   *  （画板 41 · 模型设置的图标模式选择放的是品牌 ProviderIcon），所以允许直接传
   *  节点；与 `icon` 同时给时 `node` 优先。 */
  node?: ReactNode;
  /** 原生 title 提示（如 LimitChips 芯片上的原始数值）。 */
  title?: string;
}

/**
 * 单选芯片组：画板是 `.pw-radio > span`，产品换成 `<button role="radio">`
 * （键盘可切换），键名与状态类（`.is-on`）照抄。
 *
 * **什么时候是 `PwRadio`、什么时候是 `PwSelectBox`**（判据见下；画板 62 帧 B / 帧 C
 * 逐行清点，2026-10-01 复核）：
 *   - `.pw-radio`：**少量互斥、且要一眼看全**的档位。常规页四组 —— 主题
 *     （浅色 / 深色 / 跟随系统，带 sun / moon / monitor 图标）、界面语言
 *     （简体中文 / 繁體中文 / English，与 `lib/i18n/registry.ts` 的三个 locale
 *     一一对应）、界面密度（紧凑 / 标准 / 宽松）、过程步骤默认展开
 *     （推理 / 命令 / 工具 —— 产品语义是三个**独立**开关，所以那一组是
 *     `aria-pressed` 的 `.pw-radio` 而不是 role=radio）。列表页一组 —— 技能页
 *     工具栏的作用域筛选（全部 / 项目 / 全局 / 路径，画板 62 帧 B）。
 *   - `.pw-selectbox`：**值本身是一串要背下来的标识、或选项多到芯片排不下**的字段
 *     —— UI 字体（字体栈）、UI 字号 / 聊天字号 / 扩展字号、会话命名用的模型、
 *     子代理的保存作用域与思考强度、MCP 的传输方式与来源、壁纸的适配方式与遮罩。
 *   - 画板 43 / 44 / 45 / 46 同族：插件与 MCP 的作用域及 Basic / JSON、定时任务的
 *     频率与复用策略、用量的时间范围、导入的四类资产与「按来源 / 按项目」。
 *   - 判据不是「几个选项」而是「值的性质」：`.pw-radio` 的芯片宽度跟着文案走，
 *     选项一多就把字段行那 16px gap 顶破；`.pw-selectbox` 是定宽盒（board.css:830，
 *     `min-width: 150px`），值再长也不变形。**新加字段先按这条判，别一律下拉。**
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
  return (
    <span className="pw-radio" role="radiogroup" aria-label={ariaLabel}>
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
            className={on ? "is-on" : undefined}
            onClick={() => onChange(option.value)}
          >
            {option.node
              ? option.node
              : option.icon
                ? <span className="pw-ico"><i data-ico={option.icon} data-size="12"></i></span>
                : null}
            {option.label}
          </button>
        );
      })}
    </span>
  );
}

/**
 * 下拉：画板是「静态盒 + chevron」，产品是原生 `<select>` 塞进同一个盒，
 * 原生外观由接线块 `appearance: none` 归零，chevron 仍用画板那枚图标。
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
  return (
    <span className="pw-selectbox">
      <select value={value} aria-label={ariaLabel} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <span className="pw-ico"><i data-ico="chevron-down" data-size="14"></i></span>
    </span>
  );
}

/**
 * 数值滑块：画板 40 画的是**静态**轨道（180×4、圆角 2、12px 圆钮 + 等宽读数），
 * board.css 里没有对应的类，所以这里用真 `<input type="range">` 并自带 `.pw-range`
 * 骨架（几何照抄画板那一帧，色值走 token）。
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
  return (
    <>
      <input
        id={id}
        className="pw-range"
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
