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
 * fork:upstream-0.12-terminal-parity —— 上游 #1166 的 Termux 风格额外键（Home / End /
 * PgUp / PgDn + 一次性 CTRL / ALT 修饰）按**能力**补进这条键排，不照抄上游的两行 DOM：
 * 本仓的 `.m-keybar` 是画板 M-06 帧 C 的元素，且本来就 `overflow-x:auto`。
 *
 * 键帽高度是 `--nx-ctl-sm`(36px)，命中区由 `.m-key` 的 `min-height: var(--nx-touch-min)`
 * (44px) 兜住；整条 `overflow-x:auto`，390 宽上必然要滑 —— 可接受。
 *
 * 行为：每枚键把对应的**控制序列**交给 xterm 的 `paste()`（xterm 公开面里唯一能
 * 「当作用户输入写进去」的口子）。CTRL / ALT 是**一次性**修饰：点亮后下一枚额外键
 * 带上它，随即熄灭。写进去的还是走同一条 `onData → writer.write(data)`，
 * 所以 PTY / 尺寸 / 重连 / 关闭这些一个字都没变。
 */

import { useCallback, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  NO_TERMINAL_MODIFIERS,
  terminalExtraKeySequence,
  type TerminalExtraKey,
  type TerminalModifiers,
} from "@/lib/terminal-extra-keys";

export interface TerminalKeybarMobileProps {
  /** 把一段控制序列写进终端（xterm 的 `paste`）。终端没就绪时由终端侧自己挡掉。 */
  onSequence: (sequence: string) => void;
  /** xterm 处于 application cursor keys 模式（DECCKM）时，方向键换 `ESC O` 前缀。 */
  applicationCursorKeys?: boolean;
}

/**
 * 画板帧 C 的九枚键 + 上游的额外键，顺序即 DOM 顺序（常用四件在最左）。
 *
 * fork:v5-frame-audit —— 键帽文字不动；`titleKey` 是**人话**（板上那一帧写的是
 * 「中断 / 退出全屏 / 补全路径 / 上一条历史 …」）。此前这里把控制序列本身写进了
 * title/aria-label —— 读屏念出来的是「ETX」「escape」而不是「中断」：那不是无障碍
 * 名字，是把字节码漏给了用户。序列仍由 `sequence` 原样交给终端，一个字节都没变。
 */
type KeybarKey =
  | { kind: "sequence"; label: string; sequence: string; titleKey: string }
  | { kind: "extra"; label: string; key: TerminalExtraKey; titleKey: string }
  | { kind: "modifier"; label: string; modifier: "ctrl" | "alt"; titleKey: string };

const KEYS: KeybarKey[] = [
  { kind: "sequence", label: "Ctrl-C", sequence: "\x03", titleKey: "terminal.keybar.interrupt" },
  { kind: "extra", label: "Esc", key: "Escape", titleKey: "terminal.keybar.cancel" },
  { kind: "extra", label: "Tab", key: "Tab", titleKey: "terminal.keybar.complete" },
  { kind: "modifier", label: "CTRL", modifier: "ctrl", titleKey: "terminal.keybar.ctrl" },
  { kind: "modifier", label: "ALT", modifier: "alt", titleKey: "terminal.keybar.alt" },
  { kind: "extra", label: "HOME", key: "Home", titleKey: "terminal.keybar.home" },
  { kind: "extra", label: "END", key: "End", titleKey: "terminal.keybar.end" },
  { kind: "extra", label: "PGUP", key: "PageUp", titleKey: "terminal.keybar.pageUp" },
  { kind: "extra", label: "PGDN", key: "PageDown", titleKey: "terminal.keybar.pageDown" },
  { kind: "extra", label: "↑", key: "ArrowUp", titleKey: "terminal.keybar.prevHistory" },
  { kind: "extra", label: "↓", key: "ArrowDown", titleKey: "terminal.keybar.nextHistory" },
  { kind: "extra", label: "←", key: "ArrowLeft", titleKey: "terminal.keybar.lineStart" },
  { kind: "extra", label: "→", key: "ArrowRight", titleKey: "terminal.keybar.lineEnd" },
  { kind: "sequence", label: "|", sequence: "|", titleKey: "terminal.keybar.pipe" },
  { kind: "sequence", label: "Ctrl-P", sequence: "\x10", titleKey: "terminal.keybar.prevDir" },
];

export function TerminalKeybarMobile({ onSequence, applicationCursorKeys = false }: TerminalKeybarMobileProps) {
  const { t } = useI18n();
  const [modifiers, setModifiers] = useState<TerminalModifiers>(NO_TERMINAL_MODIFIERS);

  const press = useCallback((key: KeybarKey) => {
    if (key.kind === "sequence") {
      onSequence(key.sequence);
      return;
    }
    if (key.kind === "modifier") {
      // 一次性：点亮 / 熄灭；点亮另一枚不叠加。
      setModifiers((current) => (
        key.modifier === "ctrl"
          ? { ...current, ctrl: !current.ctrl }
          : { ...current, alt: !current.alt }
      ));
      return;
    }
    onSequence(terminalExtraKeySequence(key.key, modifiers, applicationCursorKeys));
    // 额外键用掉修饰后熄灭（一次性，与上游一致）。
    setModifiers((current) => (current.ctrl || current.alt ? NO_TERMINAL_MODIFIERS : current));
  }, [applicationCursorKeys, modifiers, onSequence]);

  return (
    <div className="m-keybar" role="toolbar" aria-label="terminal-keys">
      {KEYS.map((key) => (
        <button
          key={key.label}
          type="button"
          className={key.kind === "modifier" && modifiers[key.modifier] ? "m-key is-active" : "m-key"}
          aria-pressed={key.kind === "modifier" ? modifiers[key.modifier] : undefined}
          title={t(key.titleKey)}
          aria-label={t(key.titleKey)}
          onMouseDown={(event) => event.preventDefault()}
          onPointerDown={(event) => { event.preventDefault(); if (event.button !== 0) return; press(key); }}
          onContextMenu={(event) => event.preventDefault()}
        >
          {key.label}
        </button>
      ))}
    </div>
  );
}

export default TerminalKeybarMobile;
