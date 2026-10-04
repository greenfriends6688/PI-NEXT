"use client";

import { useEffect, useMemo, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useShortcutBindings } from "@/hooks/useShortcutBindings";
import { PwaSetRow } from "@/components/pwa/PwaPage";
import { PwaSheet } from "@/components/pwa/PwaSheet";
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

/** 键帽组：一枚 `.d-kbd` 一段，多个绑定之间用 `/` 分组（别与 mac 的无分隔符混淆）。 */
function Keycaps({ row, unassigned }: { row: ShortcutGuideRow; unassigned: string }) {
  if (row.bindings.length === 0) {
    return <span className="d-t-xs d-t-faint">{unassigned}</span>;
  }
  // 不用 `aria-label`：它挂在无 role 的 `<span>` 上并非所有读屏都认，
  // 而每枚 `.d-kbd` 的文本本身就是要读的。`title` 负责给鼠标用户看整串和弦。
  return (
    <span className="fork-shortcut-guide-caps" title={row.displayText}>
      {row.capGroups.map((caps, index) => (
        <span className="fork-shortcut-guide-chord" key={`${row.id}-${index}`}>
          {index > 0 ? <span className="fork-shortcut-guide-or" aria-hidden="true">/</span> : null}
          {caps.map((cap, capIndex) => (
            <span className="d-kbd" key={`${row.id}-${index}-${capIndex}`}>{cap}</span>
          ))}
        </span>
      ))}
    </span>
  );
}

export function ShortcutGuideDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const mobile = useIsMobile();
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

  // fork:v5-landing Wave B · M-11 · 窄屏：弹窗 → `.m-sheet` 底部面板，
  // 行 = `.m-setrow`，键帽 = `.m-kbd`，分组标题 = `.m-group-title`。
  // 它仍然**只读**：数据源仍是 `useShortcutBindings()` 的实际生效绑定，
  // `managed: false` 的行依旧标注状态。
  if (mobile) {
    return (
      <PwaSheet
        open
        title={t("settings.shortcuts.guideTitle")}
        label={t("settings.shortcuts.guideTitle")}
        onClose={onClose}
        footer={
          <>
            <span className="m-t-xs m-t-faint m-grow">{t("settings.shortcuts.guideFoot")}</span>
            <button type="button" className="m-picktag is-on" onClick={onClose}>
              {t("i18n.close")}
            </button>
          </>
        }
      >
        <PwaSetRow label={isApple ? t("settings.shortcuts.guideSubApple") : t("settings.shortcuts.guideSubOther")} />
        {groups.map((group) => (
          <div className="m-cardgroup" key={group.group}>
            <div className="m-group-title">{t(group.labelKey)}</div>
            {group.rows.map((row) => (
              <PwaSetRow
                key={row.id}
                label={
                  <>
                    {t(row.labelKey)}
                    {!row.managed && (
                      <span className="m-badge warn">{t("settings.shortcuts.guideNotWired")}</span>
                    )}
                    {row.customized && (
                      <span className="m-badge mute">{t("settings.shortcuts.guideCustomized")}</span>
                    )}
                  </>
                }
                trailing={
                  row.bindings.length === 0 ? (
                    <span className="m-t-xs m-t-faint">{t("settings.shortcuts.unassigned")}</span>
                  ) : (
                    <span className="m-hist-row" title={row.displayText}>
                      {row.capGroups.map((caps, index) => (
                        <span key={`${row.id}-${index}`}>
                          {index > 0 ? <span aria-hidden="true">/</span> : null}
                          {caps.map((cap, capIndex) => (
                            <span className="m-kbd" key={`${row.id}-${index}-${capIndex}`}>{cap}</span>
                          ))}
                        </span>
                      ))}
                    </span>
                  )
                }
              />
            ))}
          </div>
        ))}
      </PwaSheet>
    );
  }

  return (
    <div
      ref={dialogRef}
      {...dialogProps}
      className="d-modal is-open fork-shortcut-guide-scrim"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      {/* fork:design-system —— 壳逐层照画板 D-21 帧 C（`.d-modal-box` › `.d-modal-head`
          标题 + grow + `.d-iconbtn` 关闭 › `.d-modal-body` 可滚动内容 › `.d-modal-foot`
          动作行）；行是 `.d-set-row` + `.d-kbd`，分组标题是 `.d-set-sec-t`。
          零新 `.pw-*` 类，产品接线在 app/fork-ui.css 的 `.fork-shortcut-guide-*`。 */}
      <div className="d-modal-box fork-shortcut-guide-modal" aria-label={t("settings.shortcuts.guideTitle")}>
        <div className="d-modal-head d-row">
          <i data-ico="keyboard" data-size="16" aria-hidden="true" />
          <span className="d-grow">{t("settings.shortcuts.guideTitle")}</span>
          <button
            type="button"
            className="d-iconbtn"
            onClick={onClose}
            title={t("i18n.close")}
            aria-label={t("i18n.close")}
          >
            <i data-ico="x" data-size="14" aria-hidden="true" />
          </button>
        </div>

        <div className="d-modal-body fork-shortcut-guide-body">
          <p className="d-t-xs d-t-faint fork-shortcut-guide-sub">
            {isApple ? t("settings.shortcuts.guideSubApple") : t("settings.shortcuts.guideSubOther")}
          </p>
          {groups.map((group) => (
            <section
              className="d-set-sec fork-shortcut-guide-group"
              key={group.group}
              // 指向可见的分组标题，而不是另写一份 aria-label（重复文本）。
              aria-labelledby={`fork-shortcut-guide-group-${group.group}`}
            >
              <div className="d-set-sec-t" id={`fork-shortcut-guide-group-${group.group}`}>
                {t(group.labelKey)}
              </div>
              {group.rows.map((row) => (
                <div className="d-set-row" key={row.id}>
                  <div className="d-set-row-box">
                    <div className="d-set-row-t">
                      {t(row.labelKey)}
                      {/* 状态必须写出来：`managed: false` 的行不在内核分发里，
                          改了设置里的绑定也还是它自己的功能在响应。 */}
                      {!row.managed ? (
                        <small className="fork-shortcut-guide-flag">{t("settings.shortcuts.guideNotWired")}</small>
                      ) : null}
                      {row.customized ? (
                        <small className="fork-shortcut-guide-flag custom">{t("settings.shortcuts.guideCustomized")}</small>
                      ) : null}
                    </div>
                  </div>
                  <span className="d-grow-last">
                    <Keycaps row={row} unassigned={t("settings.shortcuts.unassigned")} />
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div>

        <div className="d-modal-foot">
          <span className="d-t-xs d-t-faint fork-shortcut-guide-foot">{t("settings.shortcuts.guideFoot")}</span>
          <span className="d-grow" />
          <button type="button" className="d-btn sm" onClick={onClose}>
            {t("i18n.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
