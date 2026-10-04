"use client";

import { useEffect, useMemo, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useShortcutBindings } from "@/hooks/useShortcutBindings";
import { PwaSetRow } from "@/components/pwa/PwaPage";
import { PwaSheet } from "@/components/pwa/PwaSheet";
import { localCopy, type LocalCopy } from "@/components/settings-disabled-reasons";
import {
  buildShortcutGuide,
  formatShortcutBindingCapGroups,
  isApplePlatform,
  type ShortcutCommandId,
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

/**
 * fork:v5-closeout · **核对结论那一节**。
 *
 * 画板与菜单上印着六处键帽（新建任务 ⌘N / 搜索会话 ⌘K / 会话内查找 ⌘F /
 * 发送消息 ⌘⏎ / 停止这一轮 / 关闭标签 ⌘W）。对照内核实际绑定逐条核完，
 * 其中 **⌘K、⌘F、Esc 三条本来就由上面的分组列全了**（⌘F 那行自带「未接入」），
 * 剩下三条内核里根本没有对应命令，只能由各自的组件自己响应 —— 只读地图若不写
 * 出来，就等于对着一枚印在菜单上的键帽沉默。
 *
 * 「地图上列出键帽就是在承诺按了有用」这条纪律的另一面：**内核不接的键位，
 * 不许在地图上假装能改**。所以这一节是**只读陈述**：不改绑定、不改行为，
 * 只把「菜单印的」与「实际生效的」并排写出来，冲突处照实标。
 *
 * 唯一一处真冲突：⌘W 归浏览器 / 系统（关掉整个浏览器标签页），内核把它列进
 * 保留键位、永不接 —— 而「停止这一轮」在本产品里是 Esc。同一个 ⌘W 不可能
 * 既是「关标签」又是「停这一轮」，所以地图把它标成冲突而不是替用户选一个。
 */
interface ShortcutGuideGapRow {
  /** 菜单 / 画板上印的那枚键（`lib/shortcuts` 的绑定写法，只用来格式化键帽）。 */
  binding: string;
  labelKey: string;
  badgeKey: string;
  noteKey: string;
  /** 内核里真正生效的那一行（可空）：并排显示，避免只写一句「不一致」。 */
  actualCommandId?: ShortcutCommandId;
  /** 右侧那串「实际键」前面的小字（可空）。 */
  actualLabelKey?: string;
}

const GUIDE_GAPS: readonly ShortcutGuideGapRow[] = [  {
    binding: "CmdOrCtrl+n",
    labelKey: "settings.shortcuts.guideGapNewSession",
    badgeKey: "settings.shortcuts.guideGapBadgeMismatch",
    noteKey: "settings.shortcuts.guideGapNewSessionNote",
    actualCommandId: "newSession",
    actualLabelKey: "settings.shortcuts.guideGapActual",
  },
  {
    binding: "CmdOrCtrl+Enter",
    labelKey: "settings.shortcuts.guideGapSend",
    badgeKey: "settings.shortcuts.guideGapBadgeUnwired",
    noteKey: "settings.shortcuts.guideGapSendNote",
  },
  {
    binding: "CmdOrCtrl+w",
    labelKey: "settings.shortcuts.guideGapCloseTab",
    badgeKey: "settings.shortcuts.guideGapBadgeConflict",
    noteKey: "settings.shortcuts.guideGapCloseTabNote",
    actualCommandId: "stopAgent",
    actualLabelKey: "settings.shortcuts.guideGapInstead",
  },
];

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

/**
 * fork:v5-landing · D-21 帧 C 右下那张卡「地图只读，不给录制」。
 *
 * 三条都是**陈述**，不是设置项：产品已下线可编辑键位表，地图只回答「现在按什么
 * 会怎样」，所以这里既不给录制入口，也不给「恢复默认」。行形照画板
 * `.d-notice` › `.d-notice-ico`（`.circle-check`）+ `.d-set-row-t` / `.d-set-row-s`。
 *
 * 文案没走 `t()`：`lib/i18n/messages/**` 这一轮不许改（与
 * `settingsHub.ts` / `settings-disabled-reasons.ts` 同一口径），先落本地表。
 * **待办**：迁成 `settings.shortcuts.guideReadonly*` 三个键。
 */
const GUIDE_READONLY_CARD_TITLE: LocalCopy = {
  en: "The map is read-only; there is no recorder",
  "zh-CN": "地图只读，不给录制",
  "zh-TW": "地圖唯讀，不給錄製",
};

const GUIDE_READONLY_NOTES: readonly { title: LocalCopy; body: LocalCopy }[] = [
  {
    title: {
      en: "Recording and conflict handling are gone",
      "zh-CN": "录制与冲突处理已下线",
      "zh-TW": "錄製與衝突處理已下線",
    },
    body: {
      en: "The old editable keybinding table was removed together with “re-record / reset to default / enable custom keys”. This map only answers “what happens if you press it now”.",
      "zh-CN": "旧版那张可编辑键位表连同「重录 / 恢复默认 / 启用自定义键位」一起移除了，这里只回答「现在按什么会怎样」。",
      "zh-TW": "舊版那張可編輯鍵位表連同「重錄 / 恢復預設 / 啟用自訂鍵位」一起移除了，這裡只回答「現在按什麼會怎樣」。",
    },
  },
  {
    title: {
      en: "The effective value is still readable",
      "zh-CN": "生效值仍然可取",
      "zh-TW": "生效值仍然可取",
    },
    body: {
      en: "The map reads the binding that is actually in effect (an override wins over the default), so a key you changed in the past is still flagged — you just cannot change it back from here.",
      "zh-CN": "地图读的是实际生效的绑定（override 优先于默认），所以历史改过的行仍标「你改过」——只是不能再从界面改回去。",
      "zh-TW": "地圖讀的是實際生效的綁定（override 優先於預設），所以歷史改過的行仍標「你改過」——只是不能再從介面改回去。",
    },
  },
  {
    title: {
      en: "Esc is always cancel / stop the turn",
      "zh-CN": "Esc 永远是「取消 / 停止回合」",
      "zh-TW": "Esc 永遠是「取消 / 停止回合」",
    },
    body: {
      en: "This is the one exception; it never changes with the keybinding table.",
      "zh-CN": "这是唯一的例外，不随键位表变化。",
      "zh-TW": "這是唯一的例外，不隨鍵位表變化。",
    },
  },
];

export function ShortcutGuideDialog({ onClose }: { onClose: () => void }) {
  const { t, locale } = useI18n();
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

  // 核对结论那一节的每一行：菜单印的键帽 + （内核里）真正生效的那一行的键帽。
  // 两串键帽都出自 `lib/shortcuts` 的格式化函数，组件自己不拼字符串。
  const gapRows = useMemo(() => {
    const effectiveRows = groups.flatMap((group) => group.rows);
    return GUIDE_GAPS.map((gap) => {
      const actual = gap.actualCommandId
        ? effectiveRows.find((row) => row.id === gap.actualCommandId)
        : undefined;
      return {
        ...gap,
        capGroups: formatShortcutBindingCapGroups([gap.binding], platformInfo),
        actualCapGroups: actual?.capGroups ?? [],
      };
    });
  }, [groups, platformInfo]);

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
        {/* fork:v5-closeout · 窄屏把「核对结论」也列出来：与桌面同一份数据
            （`GUIDE_GAPS` + 实际生效的绑定），只读，不给任何录制入口。 */}
        <div className="m-cardgroup">
          <div className="m-group-title">{t("settings.shortcuts.guideGapTitle")}</div>
          {gapRows.map((row) => (
            <PwaSetRow
              key={row.binding}
              label={
                <>
                  {t(row.labelKey)}
                  <span className="m-badge mute">{t(row.badgeKey)}</span>
                </>
              }
              sub={t(row.noteKey)}
              trailing={
                <span className="m-t-xs m-t-faint">
                  {row.capGroups[0]?.map((cap, index) => (
                    <span className="m-kbd" key={`${row.binding}-gap-${index}`}>{cap}</span>
                  ))}
                  {row.actualLabelKey && row.actualCapGroups.length > 0 ? (
                    <>
                      {" "}
                      {t(row.actualLabelKey)}
                      {" "}
                      {row.actualCapGroups[0]?.map((cap, index) => (
                        <span className="m-kbd" key={`${row.binding}-actual-${index}`}>{cap}</span>
                      ))}
                    </>
                  ) : null}
                </span>
              }
            />
          ))}
        </div>
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

          {/* fork:v5-closeout · 核对结论 —— 菜单 / 画板上印着、但内核不接的那几条。
              行形照 D-21 帧 C 里那条 ⌘F（`.d-set-row` + `.d-set-row-s` + 右侧
              `.d-badge mute` 与 `.d-kbd`），只多一串「实际生效」的键帽并排写出来。
              它是**陈述**：不改绑定、不改行为，也不给录制入口。 */}
          <section
            className="d-set-sec fork-shortcut-guide-group"
            aria-labelledby="fork-shortcut-guide-group-gap"
          >
            <div className="d-set-sec-t" id="fork-shortcut-guide-group-gap">
              {t("settings.shortcuts.guideGapTitle")}
            </div>
            {gapRows.map((row) => (
              <div className="d-set-row" key={row.binding}>
                <div className="d-set-row-box">
                  <div className="d-set-row-t">{t(row.labelKey)}</div>
                  <div className="d-set-row-s">{t(row.noteKey)}</div>
                </div>
                <span className="d-grow-last">
                  <span className="fork-shortcut-guide-caps">
                    <span className="d-badge mute">{t(row.badgeKey)}</span>
                    {row.capGroups[0]?.map((cap, index) => (
                      <span className="d-kbd" key={`${row.binding}-gap-${index}`}>{cap}</span>
                    ))}
                    {row.actualLabelKey && row.actualCapGroups.length > 0 ? (
                      <>
                        <span className="fork-shortcut-guide-or" aria-hidden="true">→</span>
                        <span className="d-t-xs d-t-faint">{t(row.actualLabelKey)}</span>
                        {row.actualCapGroups[0]?.map((cap, index) => (
                          <span className="d-kbd" key={`${row.binding}-actual-${index}`}>{cap}</span>
                        ))}
                      </>
                    ) : null}
                  </span>
                </span>
              </div>
            ))}
          </section>

          {/* fork:v5-landing · D-21 帧 C 的「地图只读，不给录制」卡 ——
              `.d-card` › `.d-card-head`（锁形图标 + 标题）› `.d-card-body` 里三行
              `.d-notice`（`.d-notice-ico` + `.d-set-row-t` / `.d-set-row-s`）。
              纯陈述：不给任何录制 / 恢复默认入口，也不改绑定、不改行为。 */}
          {/* fork:v5-closeout · 这张卡的 margin 不写内联（既有单测钉着「组件不写内联几何」）：
              间距走本组件已有的 `.fork-shortcut-guide-group + .fork-shortcut-guide-group`
              （app/fork-ui.css），因此这张卡挂上同一个类；卡内的行距由 `.d-col` 自带
              的 `gap` 给，不再叠一份内联 gap。内容与行为一字未动。 */}
          <div className="d-card fork-shortcut-guide-group">
            <div className="d-card-head">
              <i data-ico="lock" data-size="15" aria-hidden="true" />
              {localCopy(GUIDE_READONLY_CARD_TITLE, locale)}
            </div>
            <div className="d-card-body d-col">
              {GUIDE_READONLY_NOTES.map((note) => (
                <div className="d-notice" key={note.title.en}>
                  <span className="d-notice-ico">
                    <i data-ico="circle-check" data-size="13" aria-hidden="true" />
                  </span>
                  <span className="d-col d-grow">
                    <span className="d-set-row-t">{localCopy(note.title, locale)}</span>
                    <span className="d-set-row-s">{localCopy(note.body, locale)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
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
