"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { PwBlock, PwField } from "@/components/SettingsUi";
import { ShortcutGuideDialog } from "./ShortcutGuideDialog";

/*
 * fork:proma-33-shortcut-guide —— 快捷键地图的**唯一入口**。
 *
 * 为什么不放进 `SettingsPanel.tsx` 主体：这个设置页的每一个块都直接写在
 * `GeneralSettings` 的 JSX 里，只有「一行且带 hook」的 `EnterSendModeSetting`
 * 单独成组件（见该处注释）。入口按钮正好是那种形状：自己持有 open 状态、
 * 渲染一行 `.pw-field` 与一个弹层。放这里，设置页那边就只剩
 * 「import + 一行 JSX」两处改动，弹层状态也不用塞进 `GeneralSettings`。
 */
export function ShortcutGuideEntry() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <PwBlock icon="keyboard" title={t("settings.shortcuts.guideBlockTitle")}>
        <PwField
          label={t("settings.shortcuts.guideEntryLabel")}
          hint={t("settings.shortcuts.guideEntryHint")}
          control={
            <button type="button" className="pw-btn outline sm" onClick={() => setOpen(true)}>
              {t("settings.shortcuts.guideOpen")}
            </button>
          }
        />
      </PwBlock>
      {open ? <ShortcutGuideDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}
