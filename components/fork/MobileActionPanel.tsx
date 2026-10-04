"use client";

// fork:mobile-action-panel（2026-10-03）—— 手机动作面板的**内容**（壳由 ChatInput 给）。
//
// 为什么需要它：窄屏顶栏塞不下那六七个次级动作，原来的答案是「收进一条无文字的
// 覆盖式工具条」—— 一排图标没有名字，用户得逐个试。这里把它们摆成带文字的宫格：
// 图标在上、标签在下，一屏 9 项，拇指一次够到。
//
// 为什么是「AppShell 传 ReactNode 进来」而不是 ChatInput 自己接 9 个回调：
// 这些动作的实现（handleViewFullHistory / handleAutoName / 导出 / 压缩 / 子代理 /
// 分支）**全部已经在 AppShell 里**，接成 9 个 prop 会把 ChatInput 那条已经很长的
// 属性表再拉长一截，而且每个回调都要原样透传。传一个节点则零透传、零新状态。
//
// 形态依据：`pi参考项目/pi-移动端` 的 ChatInput.kt:432-555（MorePanel）。
// 与它的一处**有意偏离**：那边 `+` 一键换面板（面板占满键盘高度）；本仓 `+` 是
// 附件（手机上最高频的动作），面板另给一枚钮，也不做「占满键盘高度」那套
// visualViewport 高度数学 —— 浮层锚在输入卡上方，键盘弹起时它就在键盘上方。
// 登记见 design/pi-web-design/DIVERGENCE.md AJ 节。
//
// fork:v5-wave-b —— 这里**故意保留 `pw-*`**（Wave B 的“顺手清掉 pw-*”不适用于本组件）：
//   1. design/v5/pwa/system.css 里**没有**对应的 m- 类（手机动作宫格在 PWA 组件库里
//      是一处真缺口，见汇报）；不许自造、不许改 design/**；
//   2. components/fork/MobileActionPanel.test.mjs 与画板 60 帧 E 都拿
//      .pw-actgrid / .pw-actcell / .pw-ico / .pw-anim-spin 当选择器
//      （“类名必须在画板上画着”那条判据），删掉就是删测试。
//   设计侧补上对应件后，再由收尾波统一换。

export interface ActionCell {
  /** 稳定标识，只用于 React key 与测试选择器。 */
  id: string;
  /** 格子上的文字。宫格里扫的是图标、读的是标签，所以短。 */
  label: string;
  /** `data-ico` 名（必须命中 design/pi-web-design/assets/icons.js）。 */
  icon: string;
  /** 触发元素一并给出：顶栏那几个浮层（子代理 / 分支）要拿它当定位锚点。 */
  onSelect: (trigger: HTMLElement) => void;
  /** 该动作当前不可用（例如没有会话、没有消息）。 */
  disabled?: boolean;
  /** 异步动作进行中：整格变淡、图标换 spinner、点击被吞。 */
  busy?: boolean;
  /** 悬停 / 无障碍用的完整说法，默认等于 label。 */
  title?: string;
}

/**
 * 带文字的宫格。`cells` 里为 null 的项会被跳过 —— 调用方按当前会话的能力
 * 拼数组（没有子代理就不给那一格），比传一堆 `showX` 布尔更直白。
 */
export function MobileActionPanel({ cells }: { cells: (ActionCell | null)[] }) {
  const visible = cells.filter((cell): cell is ActionCell => cell !== null);
  if (visible.length === 0) return null;
  return (
    <div className="pw-actgrid" role="group">
      {visible.map((cell) => {
        const blocked = cell.disabled || cell.busy;
        return (
          <button
            key={cell.id}
            type="button"
            className="pw-actcell"
            data-action-cell={cell.id}
            aria-busy={cell.busy ? "true" : undefined}
            disabled={blocked}
            title={cell.title ?? cell.label}
            aria-label={cell.title ?? cell.label}
            onClick={(event) => {
              if (blocked) return;
              cell.onSelect(event.currentTarget);
            }}
          >
            <span className="pw-ico">
              {cell.busy
                ? <i data-ico="loader-circle" data-size="17" className="pw-anim-spin" aria-hidden="true"></i>
                : <i data-ico={cell.icon} data-size="17" aria-hidden="true"></i>}
            </span>
            <span>{cell.label}</span>
          </button>
        );
      })}
    </div>
  );
}
