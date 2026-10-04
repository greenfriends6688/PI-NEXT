"use client";

/**
 * fork:zn-19 — 编辑主题（Zeno `ThemeSkinStudio.tsx`）。
 *
 * 两块：`主题设置` 与 `自定义 CSS`。11 个滑块**全部真的落到 CSS 变量上**
 * （`lib/theme-skins.ts` 的 `writeSkin`），没有只做 UI 的：焦点/缩放/压暗走壁纸层，
 * 阅读遮罩垫在消息列下，三个透明度决定侧栏/页面/卡片各让多少底透出来，模糊走
 * `backdrop-filter`，圆角写 `--radius-base`（`app/globals.css` 里所有圆角都由它派生），
 * 边框强度参与 `--border` 的混色比例。
 *
 * 保存是**整套替换**而不是逐项 patch：皮肤是一个 18 个字段的整体，逐项合并会让
 * 「取消」和「恢复默认」都要各自维护一份逆操作。
 *
 * fork:design-system —— 画板 D-07 帧 C「工作室第二屏」与画板 47 的外壳五段：
 * `.d-modal-head`（标题 + 关闭钮，页签不进头行）/ `.d-tabs` 页签行 /
 * `.d-modal-body` 内容行（左设置 1fr · 右预览 340px）/ 提示行（role=status，无消息时
 * 整行不存在）/ `.d-modal-foot` 动作行（删除 danger 仅编辑态 · 取消 / 恢复默认 / 保存 primary）。
 * 实时预览的迷你外壳是产品的功能性部件（圆角/玻璃/透明度旋钮只有画出整套
 * chrome 才看得出来），保留 `fork-skin-preview-*` 自有类 —— 登记同 Git 图泳道。
 *
 * fix:board47-css-tab（画板 47 帧 3 左半，2026-09-30）—— CSS 页签补三样：头内
 * `.d-badge warn`「高级」、文本域上方的 `.d-banner` 警告、动作行左槽在 CSS 页签
 * 变成「清空」。仍**缺**（需 lib/i18n 键或新能力，见报告）：画板那条 `.d-row`
 * 里的 `.d-btn sm`「格式化」与 `.d-badge bad` token 校验徽章。
 *
 * fix:board47-switch-vs-slider（**不改产品**，登记）—— 画板帧 1 把焦点环 / 玻璃模糊 /
 * 阅读遮罩画成 `.pw-switch`，产品这三个是滑块。复核结论：blur 是 0–40px、readingMask
 * 是 0–100% 的连续量（`lib/theme-skins.ts` 的 `SKIN_RANGES`），中间档是有意义的；
 * 「焦点环」产品根本没有这个旋钮（`ThemeSkin` 无该字段、CSS 也不发对应变量）。把连续
 * 量换成两档开关会删掉中间档，加一个开关则要动 `lib/theme-skins.ts` + CSS（超出文件
 * 范围）。所以本轮不动，判给画板：帧 1 这一处是画板滞后于实现。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useI18n } from "@/hooks/useI18n";
import {
  SKIN_RANGES,
  resolveCssColorToHex,
  resolveSkinColors,
  SKIN_WALLPAPER_FIT_VALUES,
  type SkinColorKey,
  createSkinDraft,
  type SkinMode,
  type SkinWallpaperFit,
  type ThemeSkin,
} from "@/lib/theme-skins";
import { PwField, PwRadio, PwRange, PwSelectBox } from "./SettingsUi";
import { BuiltinWallpaperPicker, builtinIdForWallpaperUrl } from "./BuiltinWallpaperPicker";
import { paintingPath } from "@/lib/wallpaper-builtin";
import { SKIN_MODE_PALETTE } from "@/lib/theme-skins";

/** 滑块按画板 47 的分组落位：几何 / 不透明度与遮罩 / 壁纸（右列）。 */
const GEOMETRY_SLIDERS: Array<{ key: keyof typeof SKIN_RANGES; labelKey: string; unit: string }> = [
  { key: "radius", labelKey: "settings.skinRadius", unit: "px" },
  { key: "borderAlpha", labelKey: "settings.skinBorderAlpha", unit: "%" },
];

const OPACITY_SLIDERS: Array<{ key: keyof typeof SKIN_RANGES; labelKey: string; unit: string }> = [
  { key: "sidebarOpacity", labelKey: "settings.skinSidebarOpacity", unit: "%" },
  { key: "pageOpacity", labelKey: "settings.skinPageOpacity", unit: "%" },
  { key: "cardOpacity", labelKey: "settings.skinCardOpacity", unit: "%" },
  { key: "blur", labelKey: "settings.skinBlur", unit: "px" },
  { key: "readingMask", labelKey: "settings.skinReadingMask", unit: "%" },
];

const WALLPAPER_SLIDERS: Array<{ key: keyof typeof SKIN_RANGES; labelKey: string; unit: string }> = [
  { key: "focusX", labelKey: "settings.skinFocusX", unit: "%" },
  { key: "focusY", labelKey: "settings.skinFocusY", unit: "%" },
  { key: "wallpaperScale", labelKey: "settings.skinWallpaperScale", unit: "%" },
  { key: "wallpaperDim", labelKey: "settings.skinWallpaperDim", unit: "%" },
];

const COLOR_FIELDS: Array<{ key: keyof ThemeSkin; labelKey: string }> = [
  { key: "accent", labelKey: "settings.skinAccent" },
  { key: "background", labelKey: "settings.skinBackground" },
  { key: "panel", labelKey: "settings.skinPanel" },
  { key: "text", labelKey: "settings.skinText" },
];

/** `<input type="color">` 只认 `#rrggbb`；基色可能是 oklch 或 color-mix，统一转一道。 */
function toColorInputValue(value: string, fallback: string): string {
  return resolveCssColorToHex(value, fallback) || fallback;
}

function SkinSlider({ entry, draft, patch, t }: {
  entry: { key: keyof typeof SKIN_RANGES; labelKey: string; unit: string };
  draft: ThemeSkin;
  patch: (next: Partial<ThemeSkin>) => void;
  t: (key: string) => string;
}) {
  const range = SKIN_RANGES[entry.key];
  const value = draft[entry.key] as number;
  const id = `skin-slider-${entry.key}`;
  return (
    <PwField label={<label htmlFor={id}>{t(entry.labelKey)}</label>} control={
      <span className="d-row">
        <PwRange
          id={id}
          value={value}
          displayValue={`${value}${entry.unit}`}
          min={range.min}
          max={range.max}
          step={range.step}
          ariaLabel={t(entry.labelKey)}
          onChange={(next) => patch({ [entry.key]: next } as Partial<ThemeSkin>)}
        />
      </span>
    } />
  );
}

export function ThemeSkinStudio({
  skin,
  isNew,
  onCancel,
  onSave,
  onDelete,
}: {
  skin: ThemeSkin;
  isNew: boolean;
  onCancel: () => void;
  onSave: (skin: ThemeSkin) => void;
  onDelete?: (id: string) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<ThemeSkin>(skin);
  const [tab, setTab] = useState<"settings" | "css">("settings");
  const [previewMode, setPreviewMode] = useState<SkinMode>(skin.mode);
  const [message, setMessage] = useState("");
  // fork:zn-19-inline 回退 — 编辑走**弹窗**（用户要求）：内联会把设置面板撑得很长，
  // 而且卡片条下方那块空间本来就窄。回到 dialog + 焦点约束。
  const { dialogRef, dialogProps } = useDialogA11y({ open: true, onClose: onCancel });

  useEffect(() => { setDraft(skin); }, [skin]);
  useEffect(() => { setPreviewMode(skin.mode); }, [skin.mode]);

  // 打开后把焦点放到名称上（弹窗里也顺手）。
  const nameRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    nameRef.current?.focus({ preventScroll: true });
  }, [skin.id, isNew]);

  const patch = (next: Partial<ThemeSkin>) => setDraft((current) => ({ ...current, ...next }));

  /** CSS 页签动作行「清空」的显隐条件：只有真的有内容时才有东西可清。 */
  const hasCustomCss = draft.customCss.trim().length > 0;

  /** 写当前模式变体的一个颜色；空串 = 清掉覆盖，回到共享值。 */
  const patchVariantColor = (key: SkinColorKey, value: string) => {
    setDraft((current) => ({
      ...current,
      [previewMode]: { ...current[previewMode], [key]: value },
    }));
  };

  const pickWallpaper = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      // 上限 3MB：皮肤会被导出/导入成 JSON，data URL 会把文件撑大 1/3。
      if (file.size > 3_000_000) {
        setMessage(t("settings.skinWallpaperTooLarge"));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          patch({ wallpaper: reader.result });
          setMessage("");
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  /* 预览用同一套派生公式，但**只作用在预览盒子里**：把 `draft` 的派生值算成
     inline style，而不是写 `<html>` 变量 —— 否则「编辑中」的皮肤会当场改掉整个应用，
     用户按「取消」时来不及回滚。 */
  const previewStyle = useMemo(() => {
    // fork:zn-19-variant — 预览按**当前选中的模式**取色：变体 → 共享 → 该模式调色板。
    // 之前这里直接用 draft 的共享基色，所以点「深色」预览纹丝不动（开关是死的）。
    const palette = SKIN_MODE_PALETTE[previewMode];
    const resolved = resolveSkinColors(draft, previewMode);
    const bg = resolved.background || palette.background;
    const pn = resolved.panel || palette.panel;
    const ac = resolved.accent || palette.accent;
    const tx = resolved.text || palette.text;
    return {
      background: bg,
      color: tx,
      "--preview-panel": `color-mix(in srgb, ${pn} ${draft.cardOpacity}%, transparent)`,
      "--preview-sidebar": `color-mix(in srgb, ${pn} ${draft.sidebarOpacity}%, transparent)`,
      "--preview-page": `color-mix(in srgb, ${bg} ${draft.pageOpacity}%, transparent)`,
      "--preview-border": `color-mix(in srgb, ${tx} ${draft.borderAlpha}%, transparent)`,
      "--preview-radius": `${draft.radius}px`,
      "--preview-blur": `${draft.blur}px`,
      "--preview-accent": ac,
      "--preview-text-muted": `color-mix(in srgb, ${tx} 62%, ${bg})`,
    } as React.CSSProperties;
  }, [draft, previewMode]);

  // fork:ui-skin-modal-portal — **必须挂到 body**：设置面板那层有 `overflow: hidden`，
  // 而皮肤接管时它又带 `backdrop-filter` —— 后者会让 `position: fixed` 相对面板定位，
  // 于是弹窗上下两端被面板裁掉（标题和保存按钮都露不全）。portal 出去就与面板无关了。
  const modal = (
    <div
      ref={dialogRef}
      {...dialogProps}
      className="d-modal is-open fork-skin-scrim"
      onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}
    >
      {/* 画板 D-07 帧 C「工作室」是设置里的第二屏；产品这里是 portal 弹窗（v5 无工作室
          弹窗画板），所以用画板弹窗原子 `.d-modal-box`（900×720 的旧尺寸由 board.css
          的 `.pw-modal` 提供，已随换皮移除 —— 见报告）。 */}
      <div
        className="d-modal-box wide fork-skin-modal"
        aria-label={isNew ? t("settings.skinNewTitle") : t("settings.skinEditTitle")}
        /* fork:pwa-skin-frame —— 900×720 的画板 47 尺寸从 inline 搬进类（值照抄，
           桌面渲染零变化）：手机档要把它从「居中 900px 对话框」改成贴底全屏
           sheet，而 inline 样式 CSS 压不过。 */
      >
        <div className="d-modal-head">
          {isNew ? t("settings.skinNewTitle") : t("settings.skinEditTitle")}
          <span className="d-grow" aria-hidden="true" />
          {/* fix:board47-css-badge（画板 47 帧 3）—— 「自定义 CSS」这一页在头里挂一枚
              `.pw-badge warn`「高级」：它是整个工作室里唯一能直接把样式表改坏的页面，
              头是「这是哪个东西」那一行，警示放在这里才不会被滚出视野。文案复用
              `models.advancedTitle`（三语都是「高级 / Advanced / 進階」）—— i18n 键在
              lib/i18n/messages/*，本轮文件范围外，不新造键（键名串味登记在报告里）。 */}
          {tab === "css" ? (
            <span className="d-badge warn">{t("models.advancedTitle")}</span>
          ) : null}
          <button type="button" className="d-iconbtn fork-pwa-hit" aria-label={t("i18n.close")} title={t("i18n.close")} onClick={onCancel}>
            <i data-ico="x" data-size="14" aria-hidden="true" />
          </button>
        </div>

        <div role="tablist" className="d-tabs">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "settings"}
            className={`d-tab${tab === "settings" ? " is-on" : ""}`}
            onClick={() => setTab("settings")}
          >
            {t("settings.skinTabSettings")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "css"}
            className={`d-tab${tab === "css" ? " is-on" : ""}`}
            onClick={() => setTab("css")}
          >
            {t("settings.skinTabCss")}
          </button>
        </div>

        {tab === "settings" ? (
          // fix:skin-preview-left（用户裁定 2026-09-30）—— 实时预览挪到**左列**。
          // 画板 47 帧 1 画的是「左设置 1fr · 右预览 340px」，用户明确要求反过来
          // （「为啥把预览放在右边了啊，应该放到左边啊」）。DOM 顺序不动，用 grid 的
          // `order` 把预览列排到第一格，两个子块各写一个 order（见下）。
          <div
            className="d-modal-body fork-pwa-skin-body"
            /* fork:pwa-skin-body —— 「左设置 1fr · 右预览 340px」的分栏从 inline
               搬进类（值逐条照抄，桌面渲染零变化），手机档才能把它收成单列：
               inline 样式是 CSS 压不过的。 */
          >
            {/* 右（原左）：设置（画板 47 帧 1：基本信息 / 四色 / 几何 / 不透明度与遮罩） */}
            <div className="fork-pwa-skin-col">
              <div className="d-set-sec-t">{t("settings.skinSectionBasic")}</div>
              <PwField label={t("settings.skinName")} control={
                <input
                  ref={nameRef}
                  type="text"
                  className="d-input"
                  style={{ minWidth: 0, width: 220 }}
                  maxLength={60}
                  value={draft.name}
                  onChange={(event) => patch({ name: event.target.value })}
                  aria-label={t("settings.skinName")}
                />
              } />
              <PwField label={t("settings.skinPreviewMode")} control={
                <PwRadio
                  value={previewMode}
                  ariaLabel={t("settings.skinPreviewMode")}
                  options={[
                    { value: "light", icon: "sun", label: t("settings.skinModeLight") },
                    { value: "dark", icon: "moon", label: t("settings.skinModeDark") },
                  ]}
                  onChange={(mode) => { setPreviewMode(mode); patch({ mode }); }}
                />
              } />

              <div className="d-set-sec-t">
                {t("settings.skinSectionColors")}
              </div>
              {/* fork:zn-19-variant — 这四个色输入编辑的是**当前模式的变体**（Zeno 的
                  `updateVariantColor`）。变体为空时显示继承来的共享值，右侧的 ↺ 可以
                  清掉覆盖、退回共享。 */}
              {COLOR_FIELDS.map((field) => {
                const key = field.key as SkinColorKey;
                const variantValue = draft[previewMode][key];
                const effective = resolveSkinColors(draft, previewMode)[key];
                const inherited = !variantValue;
                return (
                  <PwField key={String(field.key)} label={t(field.labelKey)} control={
                    <span className="d-row">
                      <input
                        type="color"
                        className="d-swatch"
                        value={toColorInputValue(effective, SKIN_MODE_PALETTE[previewMode][key])}
                        data-inherited={inherited ? "true" : undefined}
                        onChange={(event) => patchVariantColor(key, event.target.value)}
                        aria-label={t(field.labelKey)}
                      />
                      {!inherited && (
                        <button
                          type="button"
                          className="d-btn sm ghost"
                          title={t("settings.skinColorInherit")}
                          aria-label={t("settings.skinColorInherit")}
                          onClick={() => patchVariantColor(key, "")}
                        >
                          <i data-ico="undo-2" data-size="13" aria-hidden="true" />
                        </button>
                      )}
                    </span>
                  } />
                );
              })}

              <div className="d-set-sec-t">
                {t("settings.skinSectionGeometry")}
              </div>
              {GEOMETRY_SLIDERS.map((entry) => (
                <SkinSlider key={entry.key} entry={entry} draft={draft} patch={patch} t={t} />
              ))}

              <div className="d-set-sec-t">
                {t("settings.skinSectionOpacity")}
              </div>
              {OPACITY_SLIDERS.map((entry) => (
                <SkinSlider key={entry.key} entry={entry} draft={draft} patch={patch} t={t} />
              ))}
            </div>

            {/* 左（原右）：预览列（画板 47 的分栏语义保留，只是换到左侧 —— 发丝线改成右边线） */}
            <div className="fork-pwa-skin-col fork-pwa-skin-preview">
              <div className="d-set-sec-t">{t("settings.skinSectionPreview")}</div>

              {/* 迷你外壳：侧栏 + 会话列 + 作曲器（fork-skin-preview-* 是功能性预览，
                  自有类保留 —— 圆角/玻璃/透明度/边框只在这三块上同时出现时才看得出来）。 */}
              <div className="fork-skin-preview" style={previewStyle} data-mode={previewMode}>
                {draft.wallpaper ? (
                  <div
                    className="fork-skin-preview-wallpaper"
                    style={{
                      backgroundImage: `url(${draft.wallpaper})`,
                      backgroundPosition: `${draft.focusX}% ${draft.focusY}%`,
                      backgroundSize: `${draft.wallpaperScale}%`,
                    }}
                  />
                ) : null}
                <div
                  className="fork-skin-preview-mask"
                  style={{
                    background: `color-mix(in srgb, ${previewStyle.background as string} ${draft.wallpaperDim}%, transparent)`,
                  }}
                />
                <div className="fork-skin-preview-shell">
                  <div className="fork-skin-preview-sidebar">
                    <span className="fork-skin-preview-brand" />
                    <span className="fork-skin-preview-nav" data-active="true" />
                    <span className="fork-skin-preview-nav" />
                    <span className="fork-skin-preview-nav" />
                  </div>
                  <div className="fork-skin-preview-main">
                    <div className="fork-skin-preview-thread">
                      <span className="fork-skin-preview-line" style={{ width: "82%" }} />
                      <span className="fork-skin-preview-line" style={{ width: "64%" }} />
                      <span className="fork-skin-preview-line" style={{ width: "74%" }} />
                    </div>
                    <div className="fork-skin-preview-composer" />
                  </div>
                </div>
              </div>

              <div className="d-set-sec-t">
                {t("settings.skinSectionWallpaper")}
              </div>
              <div className="d-row">
                <button type="button" className="d-btn sm" onClick={pickWallpaper}>
                  {t("settings.skinChooseWallpaper")}
                </button>
                <button
                  type="button"
                  className="d-btn sm ghost"
                  disabled={!draft.wallpaper}
                  onClick={() => patch({ wallpaper: null })}
                >
                  {t("settings.skinRemoveWallpaper")}
                </button>
                <span className="d-grow" aria-hidden="true" />
                <PwSelectBox
                  value={draft.wallpaperFit}
                  ariaLabel={t("settings.skinWallpaperFit")}
                  options={SKIN_WALLPAPER_FIT_VALUES.map((fit) => ({ value: fit, label: t(`settings.skinFit_${fit}`) }))}
                  onChange={(fit) => patch({ wallpaperFit: fit as SkinWallpaperFit })}
                />
              </div>
              {WALLPAPER_SLIDERS.map((entry) => (
                <SkinSlider key={entry.key} entry={entry} draft={draft} patch={patch} t={t} />
              ))}

              {/* fork:zn-19-merge — 内置画作也能在这里直接挑：原来只有设置里的「壁纸」
                  区块能选，进工作室配皮肤时挑不到，得退出去再进来。 */}
              <BuiltinWallpaperPicker
                labelKey="settings.skinBuiltinWallpaper"
                activeId={builtinIdForWallpaperUrl(draft.wallpaper)}
                onPick={(id) => patch({ wallpaper: paintingPath(id) })}
              />
            </div>
          </div>
        ) : (
          <div className="d-modal-body fork-pwa-skin-css">
            {/* fix:board47-css-warn（画板 47 帧 3 左半）—— 文本域之上常驻一条 `.pw-alert`：
                这一页的规则会覆盖皮肤设置，写错能让界面没法用，所以警告必须**先于**
                编辑器出现，而不是等到保存失败。原先是 `.sub` 一行灰字（`.pw-sbody>p.sub`
                的样式），在弹窗里既不显眼也没有图标，等于把一句警告写成了脚注。
                文案沿用 `settings.skinCustomCssHint`（「可以覆盖任何规则 / 仅作用于本机」），
                画板那句「写错可能导致界面不可用，但可以随时重置为默认」需要新 i18n 键，
                见报告。 */}
            <div className="d-banner warn">
              <i data-ico="triangle-alert" data-size="14" aria-hidden="true" />
              <span className="d-grow">{t("settings.skinCustomCssHint")}</span>
            </div>
            <textarea
              className="d-textarea"
              style={{ minHeight: 0, height: "100%" }}
              spellCheck={false}
              value={draft.customCss}
              onChange={(event) => patch({ customCss: event.target.value })}
              placeholder={".sidebar-container { letter-spacing: 0.01em; }"}
              aria-label={t("settings.skinTabCss")}
            />
          </div>
        )}

        {/* 提示行：画板 47 —— 无消息时整行不存在。 */}
        {message ? (
          <div role="status" className="d-banner" style={{ margin: "0 var(--s4)" }}>
            <i data-ico="triangle-alert" data-size="14" aria-hidden="true" />
            <span className="grow">{message}</span>
          </div>
        ) : null}

        <footer className="d-modal-foot fork-pwa-skin-foot">
          {/* fix:board47-css-clear（画板 47 帧 3 左半）—— 动作行的**左槽按页签换语义**，
              不并排两枚 danger：CSS 页签是「清空」（清掉这份自定义规则，换一个出口），
              主题设置页签是「删除」（删掉这套皮肤）。两枚红按钮并排时用户分不清点的是
              「删这段 CSS」还是「删整套皮肤」—— 而这两件事的代价差三个数量级。
              「清空」按内容显隐：画板自己就是这么定这个槽的（帧 2 的新建态左下**没有**
              「删除」——「还没有一个能删的东西」）。空编辑器时留一枚点不动的红按钮，
              既是不留死控件，也是它自己的那条约定。 */}
          {tab === "css"
            ? (hasCustomCss ? (
              <button type="button" className="d-btn danger" onClick={() => patch({ customCss: "" })}>
                {t("tabs.clearRecent")}
              </button>
            ) : null)
            : onDelete && !isNew ? (
              <button type="button" className="d-btn danger" onClick={() => onDelete(draft.id)}>
                {t("i18n.delete")}
              </button>
            ) : null}
          <span className="d-grow" aria-hidden="true" />
          <button type="button" className="d-btn ghost" onClick={onCancel}>
            {t("i18n.cancel")}
          </button>
          <button type="button" className="d-btn" onClick={() => setDraft(createSkinDraft(draft.id, draft.name, draft.mode))}>
            {t("settings.skinReset")}
          </button>
          <button type="button" className="d-btn primary" onClick={() => onSave(draft)}>
            {t("i18n.save")}
          </button>
        </footer>
      </div>
    </div>
  );

  return typeof document === "undefined" ? modal : createPortal(modal, document.body);
}
