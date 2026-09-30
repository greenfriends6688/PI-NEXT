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
 * fork:design-system —— 画板 47「工作室对话框外壳（按实现）」五行：
 * `.pw-modal-head`（标题 + 关闭钮，页签不进头行）/ `.pw-tabs` 页签行 /
 * `.pw-modal-body` 内容行（左设置 1fr · 右预览 340px，发丝线分栏，布局照帧 1）/
 * 提示行（role=status，无消息时整行不存在）/ `.pw-modal-foot` 动作行
 * （删除 danger 仅编辑态 · 取消 / 恢复默认 outline / 保存 primary）。
 * 实时预览的迷你外壳是产品的功能性部件（圆角/玻璃/透明度旋钮只有画出整套
 * chrome 才看得出来），保留 `fork-skin-preview-*` 自有类 —— 登记同 Git 图泳道。
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
import { ConfigButton, PwField, PwRadio, PwRange, PwSelectBox, PwValue } from "./SettingsUi";
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
      <span className="pw-ctl">
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
      className="pw-scrim fork-skin-scrim"
      onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}
    >
      {/* 画板 47 帧「工作室对话框」：900×720 的 `.pw-modal`，inline 尺寸照抄画板；
          窄屏的 clamp 在 fork-ui.css 的 `.fork-skin-scrim` 接线里（窄屏语义）。 */}
      <div
        className="pw-modal fork-skin-modal"
        aria-label={isNew ? t("settings.skinNewTitle") : t("settings.skinEditTitle")}
        style={{ width: "900px", height: "720px", display: "flex", flexDirection: "column" }}
      >
        <div className="pw-modal-head">
          {isNew ? t("settings.skinNewTitle") : t("settings.skinEditTitle")}
          <span className="pw-grow" aria-hidden="true" />
          <button type="button" className="pw-iconbtn sm" aria-label={t("i18n.close")} title={t("i18n.close")} onClick={onCancel}>
            <span className="pw-ico"><i data-ico="x" data-size="14" aria-hidden="true" /></span>
          </button>
        </div>

        <div role="tablist" className="pw-tabs">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "settings"}
            className={`pw-tab${tab === "settings" ? " is-on" : ""}`}
            onClick={() => setTab("settings")}
          >
            {t("settings.skinTabSettings")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "css"}
            className={`pw-tab${tab === "css" ? " is-on" : ""}`}
            onClick={() => setTab("css")}
          >
            {t("settings.skinTabCss")}
          </button>
        </div>

        {tab === "settings" ? (
          <div className="pw-modal-body" style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "1fr 340px", overflow: "hidden" }}>
            {/* 左：设置（画板 47 帧 1：基本信息 / 四色 / 几何 / 不透明度与遮罩） */}
            <div style={{ overflowY: "auto", minHeight: 0, display: "grid", gap: "var(--s2)", alignContent: "start" }}>
              <div className="pw-sec-title">{t("settings.skinSectionBasic")}<span className="pw-grow" aria-hidden="true" /></div>
              <PwField label={t("settings.skinName")} control={
                <input
                  ref={nameRef}
                  type="text"
                  className="pw-input"
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

              <div className="pw-sec-title" style={{ marginTop: "var(--s3)" }}>
                {t("settings.skinSectionColors")}<span className="pw-grow" aria-hidden="true" />
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
                    <span className="pw-ctl">
                      <input
                        type="color"
                        value={toColorInputValue(effective, SKIN_MODE_PALETTE[previewMode][key])}
                        data-inherited={inherited ? "true" : undefined}
                        onChange={(event) => patchVariantColor(key, event.target.value)}
                        aria-label={t(field.labelKey)}
                      />
                      {!inherited && (
                        <ConfigButton
                          variant="ghost"
                          size="small"
                          title={t("settings.skinColorInherit")}
                          aria-label={t("settings.skinColorInherit")}
                          onClick={() => patchVariantColor(key, "")}
                        >
                          <span className="pw-ico"><i data-ico="rotate-ccw" data-size="13" aria-hidden="true" /></span>
                        </ConfigButton>
                      )}
                    </span>
                  } />
                );
              })}

              <div className="pw-sec-title" style={{ marginTop: "var(--s3)" }}>
                {t("settings.skinSectionGeometry")}<span className="pw-grow" aria-hidden="true" />
              </div>
              {GEOMETRY_SLIDERS.map((entry) => (
                <SkinSlider key={entry.key} entry={entry} draft={draft} patch={patch} t={t} />
              ))}

              <div className="pw-sec-title" style={{ marginTop: "var(--s3)" }}>
                {t("settings.skinSectionOpacity")}<span className="pw-grow" aria-hidden="true" />
              </div>
              {OPACITY_SLIDERS.map((entry) => (
                <SkinSlider key={entry.key} entry={entry} draft={draft} patch={patch} t={t} />
              ))}
            </div>

            {/* 右：预览列（画板 47：发丝线分栏 + 实时预览 + 壁纸） */}
            <div style={{ borderLeft: "1px solid var(--n-border-subtle)", paddingLeft: "var(--s3)", display: "grid", gap: "var(--s2)", alignContent: "start", overflowY: "auto", minHeight: 0 }}>
              <div className="pw-sec-title">{t("settings.skinSectionPreview")}<span className="pw-grow" aria-hidden="true" /></div>

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

              <div className="pw-sec-title" style={{ marginTop: "var(--s2)" }}>
                {t("settings.skinSectionWallpaper")}<span className="pw-grow" aria-hidden="true" />
              </div>
              <div className="pw-inline">
                <ConfigButton variant="secondary" size="small" onClick={pickWallpaper}>
                  {t("settings.skinChooseWallpaper")}
                </ConfigButton>
                <ConfigButton
                  variant="ghost"
                  size="small"
                  disabled={!draft.wallpaper}
                  onClick={() => patch({ wallpaper: null })}
                >
                  {t("settings.skinRemoveWallpaper")}
                </ConfigButton>
                <span className="pw-grow" aria-hidden="true" />
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
          <div className="pw-modal-body" style={{ flex: 1, minHeight: 0, overflow: "hidden", gridTemplateRows: "auto 1fr" }}>
            <p className="sub">{t("settings.skinCustomCssHint")}</p>
            <textarea
              className="pw-textarea"
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
          <div role="status" className="pw-alert" style={{ margin: "0 var(--s4)" }}>
            <span className="pw-ico"><i data-ico="triangle-alert" data-size="14" aria-hidden="true" /></span>
            <span className="grow">{message}</span>
          </div>
        ) : null}

        <footer className="pw-modal-foot">
          {onDelete && !isNew ? (
            <ConfigButton variant="danger" onClick={() => onDelete(draft.id)}>
              {t("i18n.delete")}
            </ConfigButton>
          ) : null}
          <span className="pw-grow" aria-hidden="true" />
          <ConfigButton variant="ghost" onClick={onCancel}>
            {t("i18n.cancel")}
          </ConfigButton>
          <ConfigButton variant="secondary" onClick={() => setDraft(createSkinDraft(draft.id, draft.name, draft.mode))}>
            {t("settings.skinReset")}
          </ConfigButton>
          <ConfigButton variant="primary" onClick={() => onSave(draft)}>
            {t("i18n.save")}
          </ConfigButton>
        </footer>
      </div>
    </div>
  );

  return typeof document === "undefined" ? modal : createPortal(modal, document.body);
}
