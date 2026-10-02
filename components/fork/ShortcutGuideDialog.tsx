"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useShortcutBindings } from "@/hooks/useShortcutBindings";
import {
  buildShortcutGuide,
  isApplePlatform,
  type ShortcutGuideRow,
  type ShortcutPlatformInfo,
} from "@/lib/shortcuts";

/*
 * fork:proma-33-shortcut-guide —— 只读的「快捷键地图」对话框。
 *
 * 它与（已被用户裁掉的）快捷键设置表是**两件事**：那张表是录制与冲突处理，
 * 这张地图只回答「现在按什么会怎样」。所以这里的每一条都取
 * **实际生效的绑定**（`hooks/useShortcutBindings` 读到的 override 优先于
 * `defaultBindings`），并且按本平台渲染键帽（mac `⌘⇧L`，其它平台
 * `Ctrl+Shift+L`）—— 全部由 `lib/shortcuts.ts` 的纯函数算好，组件不拼字符串。
 *
 * 一条**硬要求**：`managed: false` 的行（`findInConversation`，⌘F 由它自己的
 * 功能注册、不经过内核分发）必须显式标注状态。地图列出一串键帽就是在承诺
 * 「按了有用」，不标注就等于骗人 —— 这也是参考项目给未注册键位加
 * `当前未注册` 状态的原因。
 *
 * 无障碍走 `hooks/useDialogA11y`（焦点陷阱 / Esc 关闭 / inert 背景），
 * 不在这里手搓第二套。
 */

/** 键帽组：一枚 `.pw-kbd` 一段，多个绑定之间用 `/` 分组（别与 mac 的无分隔符混淆）。 */
function Keycaps({ row, unassigned }: { row: ShortcutGuideRow; unassigned: string }) {
  if (row.bindings.length === 0) {
    return <span className="pw-hint">{unassigned}</span>;
  }
  // 不用 `aria-label`：它挂在无 role 的 `<span>` 上并非所有读屏都认，
  // 而每枚 `.pw-kbd` 的文本本身就是要读的。`title` 负责给鼠标用户看整串和弦。
  return (
    <span className="fork-shortcut-guide-caps" title={row.displayText}>
      {row.capGroups.map((caps, index) => (
        <span className="fork-shortcut-guide-chord" key={`${row.id}-${index}`}>
          {index > 0 ? <span className="fork-shortcut-guide-or" aria-hidden="true">/</span> : null}
          {caps.map((cap, capIndex) => (
            <span className="pw-kbd" key={`${row.id}-${index}-${capIndex}`}>{cap}</span>
          ))}
        </span>
      ))}
    </span>
  );
}

export function ShortcutGuideDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { overrides } = useShortcutBindings();

  // fork:proma-33-shortcut-guide —— 平台要在客户端判定：SSR 那一刻读不到
  // navigator，硬判一个值会让 mac 用户闪一下 `Ctrl+…`。`null` 表示「还没判」，
  // 此时**键帽与副标题都交给 `isApplePlatform(undefined)` 自己的环境兜底**，
  // 两者必须是同一个值 —— 否则会出现标题说 Mac、键帽写 Ctrl+ 的自相矛盾。
  const [platform, setPlatform] = useState<ShortcutPlatformInfo | null>(null);
  useEffect(() => {
    setPlatform({ platform: window.navigator.platform, userAgent: window.navigator.userAgent });
  }, []);

  const platformInfo = platform ?? undefined;
  const groups = useMemo(() => buildShortcutGuide(overrides, platformInfo), [overrides, platformInfo]);
  const isApple = isApplePlatform(platformInfo);

  const { dialogRef, dialogProps } = useDialogA11y({ open: true, onClose });

  return (
    <div
      ref={dialogRef}
      {...dialogProps}
      className="pw-scrim fork-shortcut-guide-scrim"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      {/* fork:design-system —— 壳逐层照画板 50 的对话框（`.pw-scrim` › `.pw-modal` ›
          `.pw-modal-head` 标题 + grow + `.pw-iconbtn.sm` 关闭 › `.pw-modal-body`
          可滚动内容 › `.pw-modal-foot` 动作行）；行本身是画板 45 快捷键表的
          `.pw-field` + `.pw-ctl` + `.pw-kbd`，分组标题是 `.pw-sec-title`。
          零新 `.pw-*` 类，产品接线在 app/fork-ui.css 的 `.fork-shortcut-guide-*`。 */}
      <div className="pw-modal fork-shortcut-guide-modal" aria-label={t("settings.shortcuts.guideTitle")}>
        <div className="pw-modal-head">
          <span className="pw-ico"><i data-ico="keyboard" data-size="16" aria-hidden="true"></i></span>
          <span className="pw-grow">{t("settings.shortcuts.guideTitle")}</span>
          <button
            type="button"
            className="pw-iconbtn sm"
            onClick={onClose}
            title={t("i18n.close")}
            aria-label={t("i18n.close")}
          >
            <span className="pw-ico"><i data-ico="x" data-size="14" aria-hidden="true"></i></span>
          </button>
        </div>

        <div className="pw-modal-body fork-shortcut-guide-body">
          <p className="pw-hint fork-shortcut-guide-sub">
            {isApple ? t("settings.shortcuts.guideSubApple") : t("settings.shortcuts.guideSubOther")}
          </p>
          {groups.map((group) => (
            <section
              className="fork-shortcut-guide-group"
              key={group.group}
              // 指向可见的分组标题，而不是另写一份 aria-label（重复文本）。
              aria-labelledby={`fork-shortcut-guide-group-${group.group}`}
            >
              <div className="pw-sec-title" id={`fork-shortcut-guide-group-${group.group}`}>
                {t(group.labelKey)}
                <span className="grow" />
              </div>
              {group.rows.map((row) => (
                <div className="pw-field" key={row.id}>
                  <span className="pw-label">
                    {t(row.labelKey)}
                    {/* 状态必须写出来：`managed: false` 的行不在内核分发里，
                        改了设置里的绑定也还是它自己的功能在响应。 */}
                    {!row.managed ? (
                      <small className="fork-shortcut-guide-flag">{t("settings.shortcuts.guideNotWired")}</small>
                    ) : null}
                    {row.customized ? (
                      <small className="fork-shortcut-guide-flag custom">{t("settings.shortcuts.guideCustomized")}</small>
                    ) : null}
                  </span>
                  <span className="pw-ctl">
                    <Keycaps row={row} unassigned={t("settings.shortcuts.unassigned")} />
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div>

        <div className="pw-modal-foot">
          <span className="pw-hint fork-shortcut-guide-foot">{t("settings.shortcuts.guideFoot")}</span>
          <span className="pw-grow" />
          <button type="button" className="pw-btn sm" onClick={onClose}>
            {t("i18n.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
