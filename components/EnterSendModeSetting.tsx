"use client";

import { setEnterSendMode, useEnterSendMode, type EnterSendMode } from "@/hooks/useEnterSendMode";
import { useI18n } from "@/hooks/useI18n";
import { PwField, PwRadio } from "./SettingsUi";

/**
 * fork:send-key（G6 · 上游 `5df8278` #1001）—— 设置页「发送键」一行。
 *
 * 两档互斥、都要一眼看全 → 画板的 `.pw-radio` 芯片组（`PwRadio`），不是
 * 下拉（判据见 SettingsUi 的 PwRadio 注释）。单独一个文件是因为它带 hook：
 * 设置页只需要把这行放进「聊天」块，不该为了一个偏好多背一个订阅。
 *
 * 上游用的是自绘的 `settings-send-mode-*` 分段控件 + `sr-only` 原生 radio；
 * 那套形态画板里没有对应物，按判据⑦不新造类，改用 `.pw-field` + `.pw-radio`
 * —— 与同一块里的主题 / 语言 / 界面密度三行完全同款。
 */
export function EnterSendModeSetting() {
  const { t } = useI18n();
  const enterSendMode = useEnterSendMode();
  return (
    <PwField
      label={t("settings.sendKey")}
      hint={t("settings.sendKeyHint")}
      control={
        <PwRadio<EnterSendMode>
          value={enterSendMode}
          ariaLabel={t("settings.sendKey")}
          options={[
            { value: "enter", label: t("settings.sendKeyEnter") },
            { value: "ctrlEnter", label: t("settings.sendKeyCtrlEnter") },
          ]}
          onChange={setEnterSendMode}
        />
      }
    />
  );
}