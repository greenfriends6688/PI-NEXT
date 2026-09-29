"use client";

/**
 * fork:design-system SW-07 — 壁纸设置改用画板 40 的 `.pw-block` 行规格。
 *
 * 画板 40「默认外观壁纸」块画了四行：启用壁纸（`.pw-switch`）、当前壁纸
 * （`.pw-ctl` + 缩略图 + 更换 / 移除）、适配方式（`.pw-selectbox`）、遮罩浓度
 * （等宽读数）。产品把「适配方式」换成三行真实存在的作用域选择（消息区 / 侧栏面板 /
 * 输入框），遮罩浓度给的是真滑块 —— 行形态与控件种类都照画板，只换数据。
 *
 * 原实现（fork:ui-wallpaper / fork:zn-19）是自绘的 `settings-wallpaper-*`
 * 一排按钮 + 复选开关，已退役。
 *
 * 图片是用户数据（data URL），缩略图的 `background-image` 只能内联；
 * 几何与边框来自 `app/fork-ui.css` 的 `.pw-wallpaper-thumb`（值照抄画板那一帧）。
 */

import { useRef, useState, type ChangeEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useWallpaper } from "@/hooks/useWallpaper";
import { PwCtl, PwField, PwRange, PwSelectBox, PwSwitch } from "./SettingsUi";
import {
  WALLPAPER_SCRIM_MAX,
  WALLPAPER_SCRIM_MIN,
  WALLPAPER_MIME_TYPES,
  type WallpaperAreaMode,
} from "@/lib/wallpaper";

const AREA_MODES: WallpaperAreaMode[] = ["none", "trans", "blur"];

/**
 * Wallpaper settings.
 *
 * The image is stored as a data URL in localStorage, so the picker reports the
 * two failures that actually happen: an unsupported type (SVG is rejected on
 * purpose — it is a script surface, not an image) and an image too large to fit
 * the storage budget after re-encoding.
 *
 * Per-area modes exist because a wallpaper that reaches *everything* makes
 * dense surfaces (the composer, the code blocks) unreadable. Each area therefore
 * opts into `none` (solid), `trans` (translucent) or `blur` (frosted).
 */
export function WallpaperSettings({
  skinActive = false,
  onEditSkin,
}: {
  /**
   * fork:zn-19-merge — 有自定义皮肤生效时，壁纸与各面透明度由**皮肤**决定
   * （`html[data-theme-skin="true"]` 那一组 CSS 会接管，全局的 per-area 模式被显式排除）。
   * 这时再摆一排滑块就是「看着能调、其实无效」的死控件，所以改成说明 + 去编辑皮肤。
   */
  skinActive?: boolean;
  onEditSkin?: () => void;
} = {}) {
  const { t } = useI18n();
  const {
    enabled,
    url,
    scrim,
    inputMode,
    panelMode,
    messageMode,
    usingBuiltin,
    choose,
    remove,
    setEnabled,
    setScrim,
    setInputMode,
    setPanelMode,
    setMessageMode,
  } = useWallpaper();

  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onPick = () => {
    setError(null);
    fileRef.current?.click();
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset immediately so picking the same file twice still fires a change.
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      await choose(file);
      setError(null);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(t(
        code === "unsupported-type" ? "settings.wallpaperBadType"
          : code === "too-large" ? "settings.wallpaperTooLarge"
            : "settings.wallpaperFailed",
      ));
    } finally {
      setBusy(false);
    }
  };

  const areaRow = (
    labelKey: string,
    value: WallpaperAreaMode,
    onChange: (mode: WallpaperAreaMode) => void,
  ) => (
    <PwField
      label={t(labelKey)}
      control={
        <PwSelectBox
          value={value}
          ariaLabel={t(labelKey)}
          options={AREA_MODES.map((mode) => ({
            value: mode,
            label: t(
              mode === "none" ? "settings.wallpaperModeNone"
                : mode === "trans" ? "settings.wallpaperModeTrans"
                  : "settings.wallpaperModeBlur",
            ),
          }))}
          onChange={(next) => onChange(next as WallpaperAreaMode)}
        />
      }
    />
  );

  if (skinActive) {
    return (
      <div className="pw-alert info">
        <span className="pw-ico"><i data-ico="info" data-size="14" aria-hidden="true" /></span>
        <span className="pw-grow">{t("settings.wallpaperSkinOwned")}</span>
        {onEditSkin ? (
          <button type="button" className="pw-btn outline sm" onClick={onEditSkin}>
            {t("settings.wallpaperSkinOwnedEdit")}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept={WALLPAPER_MIME_TYPES.join(",")}
        className="sr-only"
        aria-label={t("settings.wallpaperChoose")}
        onChange={(event) => void onFile(event)}
      />

      <PwField
        label={t("settings.wallpaperEnabled")}
        hint={t("settings.wallpaperDescription")}
        control={
          <PwSwitch
            checked={enabled}
            label={t("settings.wallpaperEnabled")}
            onChange={setEnabled}
          />
        }
      />

      {/* 画板 40 的「当前壁纸」行：缩略图 + 更换 / 移除。没选图时只剩「选择图片」。 */}
      <PwField
        label={t("settings.wallpaper")}
        control={
          <PwCtl>
            {url ? <span className="pw-wallpaper-thumb" style={{ backgroundImage: `url(${url})` }} /> : null}
            <button type="button" className="pw-btn outline sm" disabled={busy} onClick={onPick}>
              {busy
                ? t("settings.wallpaperBusy")
                : url
                  ? t("settings.wallpaperReplace")
                  : t("settings.wallpaperChoose")}
            </button>
            {url ? (
              <button type="button" className="pw-btn sm" onClick={remove}>
                {t("settings.wallpaperRemove")}
              </button>
            ) : null}
          </PwCtl>
        }
      />

      {/* 画板没有「说明句」这一行；画板 47 的提示一律是 `.pw-alert`（提示蓝 / 报错红）。 */}
      {enabled && !url ? (
        <div className="pw-alert info">
          <span className="pw-ico"><i data-ico="info" data-size="14" aria-hidden="true" /></span>
          <span className="pw-grow">{t("settings.wallpaperBuiltinNote")}</span>
        </div>
      ) : null}
      {enabled && usingBuiltin ? (
        <div className="pw-alert info">
          <span className="pw-ico"><i data-ico="info" data-size="14" aria-hidden="true" /></span>
          <span className="pw-grow">{t("settings.wallpaperBuiltinActive")}</span>
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="pw-alert">
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="14" aria-hidden="true" /></span>
          <span className="pw-grow">{error}</span>
        </div>
      ) : null}

      {/* fork:ui-wallpaper — the scrim slider and the per-area modes drive the
          built-in painting too, so they must not be gated on a user image. */}
      {enabled ? (
        <>
          <PwField
            label={t("settings.wallpaperScrim")}
            hint={t("settings.wallpaperScrimDescription")}
            htmlFor="settings-wallpaper-scrim"
            control={
              <PwCtl>
                <PwRange
                  id="settings-wallpaper-scrim"
                  value={scrim}
                  displayValue={`${scrim}%`}
                  min={WALLPAPER_SCRIM_MIN}
                  max={WALLPAPER_SCRIM_MAX}
                  ariaLabel={t("settings.wallpaperScrim")}
                  onChange={setScrim}
                />
              </PwCtl>
            }
          />
          {areaRow("settings.wallpaperAreaMessage", messageMode, setMessageMode)}
          {areaRow("settings.wallpaperAreaPanel", panelMode, setPanelMode)}
          {areaRow("settings.wallpaperAreaInput", inputMode, setInputMode)}
        </>
      ) : null}
    </>
  );
}
