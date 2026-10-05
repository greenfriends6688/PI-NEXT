"use client";

import { setEnterSendMode, useEnterSendMode, type EnterSendMode } from "@/hooks/useEnterSendMode";
import { useI18n } from "@/hooks/useI18n";
import { localCopy, type LocalCopy } from "./settings-disabled-reasons";
import { PwPaneCard, PwRadioRow } from "./SettingsUi";

/**
 * fork:send-key（G6 · 上游 `5df8278` #1001）—— 设置页「发送键」一行。
 *
 * 两档互斥 → 画板的**单选行**（`PwRadioRow` = `button.d-radiorow`：圆点 + 标题 + 副标题，
 * 整行可点），不是下拉。判据：两档各自要带一句「代价」说明（画板 D-07 帧 B 的
 * `.d-radiorow-s`），分段芯片（`.d-seg`）只装两个字的档名。
 * 单独一个文件是因为它带 hook：
 * 设置页只需要把这行放进「聊天」块，不该为了一个偏好多背一个订阅。
 *
 * fork:v5-landing-frame · D-07 帧 A / D-07b 帧 B（2026-10-05 逐帧核对）——
 * 两档各自还有**一段后果说明**（板面原文 `section > .d-banner`）：
 *   · Enter 发送：回车发送时 `Shift`+`Enter` 换行；连按两次回车也会换行 ——
 *     写到一半的列表不会被自己发出去。
 *   · Ctrl+Enter 发送：回车永远是换行，直接输入的 `!` 与 `!!` 命令仍走 Bash。
 * 产品此前只有那枚分段选择器，这两段整段 MISSING。`d-kbd`（板面里的键帽）与
 * `d-mono` 都是库里现成的类，这里按板面原文摆，不新造。
 *
 * 文案走本地表（`lib/i18n/messages/**` 不在本轮文件范围）。文案里的 `{Shift}` /
 * `{!}` 这种花括号记号渲染成板面同款的键帽 / 等宽块（`.d-kbd` / `.d-mono`），
 * 免得拼一句中文时把两种标记写成两个不同的类。
 */
const SEND_KEY_PANE = {
  enter: {
    en: "With Enter sending, {Shift} {Enter} inserts a line break, and pressing Enter twice also breaks the line — a half-written list never sends itself.",
    "zh-CN": "回车发送时 {Shift} {Enter} 换行；连按两次回车也会换行 —— 写到一半的列表不会被自己发出去。",
    "zh-TW": "Enter 送出時 {Shift} {Enter} 換行；連按兩次 Enter 也會換行 —— 寫到一半的清單不會自己送出去。",
  },
  ctrlEnter: {
    en: "With {Ctrl} {Enter} sending, Enter is always a line break, and a typed {!} or {!!} still goes to Bash.",
    "zh-CN": "{Ctrl} {Enter} 发送时，回车永远是换行，直接输入的 {!} 与 {!!} 命令仍走 Bash。",
    "zh-TW": "{Ctrl} {Enter} 送出時，Enter 永遠是換行，直接輸入的 {!} 與 {!!} 指令仍走 Bash。",
  },
} satisfies Record<string, LocalCopy>;

/** 两档各自的**副标题**（画板 `.d-radiorow-s`）：一句短话，把「这一档的代价」说在前面，
 * 选完下面那条 `.d-banner` 再展开讲。与 `SEND_KEY_PANE` 同一张本地表、同一套语言键，
 * 因为 `lib/i18n/messages/**` 不在本轮文件范围（同文件头的口径）。 */
const SEND_KEY_ROW = {
  enter: {
    en: "Enter sends; {Shift} {Enter} breaks the line",
    "zh-CN": "回车直接发送；换行用 {Shift} {Enter}",
    "zh-TW": "Enter 直接送出；換行用 {Shift} {Enter}",
  },
  ctrlEnter: {
    en: "Enter breaks the line; {Ctrl} {Enter} sends",
    "zh-CN": "回车永远是换行；{Ctrl} {Enter} 才发送",
    "zh-TW": "Enter 永遠換行；{Ctrl} {Enter} 才送出",
  },
} satisfies Record<string, LocalCopy>;

/** `{…}` 里的短标记 → `.d-kbd`（键帽）；`!` / `!!` 这类命令 → `.d-mono`。 */
function renderPaneCopy(text: string) {
  return text.split(/(\{[^{}]+\})/).map((part, index) => {
    if (!part.startsWith("{")) return part;
    const label = part.slice(1, -1);
    return /^!/.test(label)
      ? <span key={index} className="d-mono">{label}</span>
      : <span key={index} className="d-kbd">{label}</span>;
  });
}

export function EnterSendModeSetting() {
  const { locale, t } = useI18n();
  const enterSendMode = useEnterSendMode();
  return (
    <>
      {/* fork:v5-landing-frame · D-07 帧 B —— 「多选一」的档位在板面上是**整行单选**
          （`button.d-radiorow`：圆点 + 标题 + 副标题，整行可点），不是分段芯片：
          两档各自带一句说明，值不再是两个字的词。所以这一段从 `PwRadio`（`.d-seg`）
          换成 `PwRadioRow`（`.d-radiorow`）—— 同一个 `useEnterSendMode` / 同一个
          `setEnterSendMode`，行为零变化；标签行与列表是画板里的两级，由本件一起出。 */}
      <PwRadioRow<EnterSendMode>
        label={t("settings.sendKey")}
        hint={t("settings.sendKeyHint")}
        value={enterSendMode}
        ariaLabel={t("settings.sendKey")}
        options={[
          {
            value: "enter",
            label: t("settings.sendKeyEnter"),
            hint: renderPaneCopy(localCopy(SEND_KEY_ROW.enter, locale)),
          },
          {
            value: "ctrlEnter",
            label: t("settings.sendKeyCtrlEnter"),
            hint: renderPaneCopy(localCopy(SEND_KEY_ROW.ctrlEnter, locale)),
          },
        ]}
        onChange={setEnterSendMode}
      />
      {/* 两段都在 DOM 里（不选中的那段 `hidden`），与板面的 `data-demo-pane` 一致。 */}
      <PwPaneCard hidden={enterSendMode !== "enter"} icon="info">
        {renderPaneCopy(localCopy(SEND_KEY_PANE.enter, locale))}
      </PwPaneCard>
      <PwPaneCard hidden={enterSendMode !== "ctrlEnter"} icon="info">
        {renderPaneCopy(localCopy(SEND_KEY_PANE.ctrlEnter, locale))}
      </PwPaneCard>
    </>
  );
}