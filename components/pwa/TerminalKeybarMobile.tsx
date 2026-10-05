"use client";

/**
 * M-06 帧 C · 终端软键盘键排。
 *
 * 手机上系统软键盘把 Esc / Ctrl-C / Tab / 方向键全吃掉，桌面版**完全没有**这一行，
 * 手机版不能省。这里照 `design/v5/pwa/boards/M-06-files-terminal.html` 帧 C 的
 * DOM 原文抄 `.m-keybar` + `.m-key`，键序与画板一致（常用四件排最左）：
 *
 *     Ctrl-C · Esc · Tab · ↑ · ↓ · ← · → · | · Ctrl-P
 *
 * 键帽高度是 `--nx-ctl-sm`(36px)，命中区由 `.m-key` 的 `min-height: var(--nx-touch-min)`
 * (44px) 兜住；整条 `overflow-x:auto`，390 宽上 9 键必然要滑 —— 可接受。
 *
 * 行为：每枚键把对应的**控制序列**交给 xterm 的 `paste()`（xterm 公开面里唯一能
 * 「当作用户输入写进去」的口子；`attachCustomKeyEventHandler` 那条路只能拦真实
 * 键盘事件，软键盘弹出的物理键盘也未必带这些键）。写进去的还是走同一条
 * `onData → writer.write(data)`，所以 PTY / 尺寸 / 重连 / 关闭这些一个字都没变。
 */

import { useCallback } from "react";
import { useI18n } from "@/hooks/useI18n";

export interface TerminalKeybarMobileProps {
  /** 把一段控制序列写进终端（xterm 的 `paste`）。终端没就绪时由终端侧自己挡掉。 */
  onSequence: (sequence: string) => void;
}

/**
 * 画板帧 C 的九枚键，顺序即 DOM 顺序（常用四件在最左）。
 *
 * fork:v5-frame-audit —— 键帽文字不动；`titleKey` 是**人话**（板上那一帧写的是
 * 「中断 / 退出全屏 / 补全路径 / 上一条历史 …」）。此前这里把控制序列本身写进了
 * title/aria-label —— 读屏念出来的是「ETX」「escape」而不是「中断」：那不是无障碍
 * 名字，是把字节码漏给了用户。序列仍由 `sequence` 原样交给终端，一个字节都没变。
 */
const KEYS: Array<{ label: string; sequence: string; titleKey: string }> = [
  // Ctrl-C：0x03（ETX）。先发 ^C 再发回车，shell 才会把这一行交出去。
  { label: "Ctrl-C", sequence: "\x03", titleKey: "terminal.keybar.interrupt" },
  { label: "Esc", sequence: "\x1b", titleKey: "terminal.keybar.cancel" },
  { label: "Tab", sequence: "\t", titleKey: "terminal.keybar.complete" },
  { label: "↑", sequence: "\x1b[A", titleKey: "terminal.keybar.prevHistory" },
  { label: "↓", sequence: "\x1b[B", titleKey: "terminal.keybar.nextHistory" },
  { label: "←", sequence: "\x1b[D", titleKey: "terminal.keybar.lineStart" },
  { label: "→", sequence: "\x1b[C", titleKey: "terminal.keybar.lineEnd" },
  { label: "|", sequence: "|", titleKey: "terminal.keybar.pipe" },
  { label: "Ctrl-P", sequence: "\x10", titleKey: "terminal.keybar.prevDir" },
];

export function TerminalKeybarMobile({ onSequence }: TerminalKeybarMobileProps) {
  const { t } = useI18n();
  const press = useCallback((sequence: string) => {
    onSequence(sequence);
  }, [onSequence]);

  return (
    <div className="m-keybar" role="toolbar" aria-label="terminal-keys">
      {KEYS.map((key) => (
        <button
          key={key.label}
          type="button"
          className="m-key"
          title={t(key.titleKey)}
          aria-label={t(key.titleKey)}
          onClick={() => press(key.sequence)}
        >
          {key.label}
        </button>
      ))}
    </div>
  );
}

export default TerminalKeybarMobile;