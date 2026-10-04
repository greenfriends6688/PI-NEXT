"use client";

/**
 * fork:design-system SW-07 — 壁纸设置改用画板 D-07b「默认外观壁纸」块的行规格。
 *
 * 画板 D-07b「默认外观壁纸」块画了几行：显示壁纸（`.d-switch`）、当前壁纸
 * （缩略图 + 更换 / 移除）、遮罩浓度（`.d-slider` + 等宽读数）、各面适配
 * （三面并排 + 每面一排芯片）。产品把「适配方式」拆成三个真实存在的作用域
 * （消息区 / 侧栏面板 / 输入框），遮罩浓度给的是真滑块 —— 行形态与控件种类都照画板，
 * 只换数据。
 *
 * fix:board47-area-chips（2026-09-30）—— 三个作用域从下拉换成「各面适配」的芯片排。
 * 理由不是好看：三档只有「不透明 / 半透明 / 毛玻璃」，下拉把另外两档折进一个箭头里，
 * 用户得点开才知道这个面能选什么；芯片一排摊开，三面并排一眼可比。产品走
 * `SettingsUi` 的 `PwRadio`（键盘可达 + `role="radiogroup"`），不新造控件。
 *
 * fork:v5-landing Wave B（M-05）—— 窄屏：这三块换 M-05 的 `m-*`：
 * 横幅 `m-banner`、按钮 `m-btn`、三面网格 `m-grid2`、芯片排 `m-cats` / `m-cat`。
 *
 * 与画板的**数量**差异保持登记：画板画的是四个面（侧栏 / 主区 / 右栏 / 输入框），
 * 产品是三个（消息区 / 侧栏面板 / 输入框）。补第四个面要动 `lib/wallpaper.ts`
 * （新增一个持久字段 + 迁移旧状态）与 `app/wallpaper.css` 的取值分支，超出组件范围，
 * 见报告。画板帧 3 的「各面适配」小标题同样缺：它需要一个新的 i18n 键。
 *
 * 原实现（fork:ui-wallpaper / fork:zn-19）是自绘的 `settings-wallpaper-*`
 * 一排按钮 + 复选开关，已退役。
 *
 * 图片是用户数据（data URL），缩略图的 `background-image` 只能内联；
 * 几何与边框来自形态表的 `.d-thumb`。
 */

import { useRef, useState, type ChangeEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useWallpaper } from "@/hooks/useWallpaper";
import { PwField, PwRange, PwSwitch } from "./SettingsUi";
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
  const isMobile = useIsMobile();
  const bannerClass = isMobile ? "m-banner" : "d-banner info";
  const errBannerClass = isMobile ? "m-banner" : "d-banner err";
  const btnClass = isMobile ? "m-btn" : "d-btn sm";
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

  const areaField = (
    labelKey: string,
    value: WallpaperAreaMode,
    onChange: (mode: WallpaperAreaMode) => void,
  ) => (
    <div className="d-col" key={labelKey}>
      <span className={isMobile ? "m-t-sm" : "d-t-sm"}>{t(labelKey)}</span>
      <div
        className={isMobile ? "m-cats" : "d-cats"}
        role="radiogroup"
        aria-label={t(labelKey)}
      >
        {AREA_MODES.map((mode) => {
          const on = value === mode;
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={on}
              className={`${isMobile ? "m-cat" : "d-cat"}${on ? " is-on" : ""}`}
              onClick={() => onChange(mode)}
            >
              {t(
                mode === "none" ? "settings.wallpaperModeNone"
                  : mode === "trans" ? "settings.wallpaperModeTrans"
                    : "settings.wallpaperModeBlur",
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  if (skinActive) {
    return (
      <div className={bannerClass}>
        <i data-ico="info" data-size="14" aria-hidden="true" />
        <span className={isMobile ? "m-grow" : "d-grow"}>{t("settings.wallpaperSkinOwned")}</span>
        {onEditSkin ? (
          <button type="button" className={btnClass} onClick={onEditSkin}>
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

      {/* 画板 D-07b 的「当前壁纸」行：缩略图 + 更换 / 移除。没选图时只剩「选择图片」。 */}
      <PwField
        label={t("settings.wallpaperCurrent")}
        control={
          <span className="d-row">
            {url ? <span className="d-thumb" style={{ backgroundImage: `url(${url})` }} /> : null}
            <button type="button" className={btnClass} disabled={busy} onClick={onPick}>
              {busy
                ? t("settings.wallpaperBusy")
                : url
                  ? t("settings.wallpaperReplace")
                  : t("settings.wallpaperChoose")}
            </button>
            {url ? (
              <button type="button" className={btnClass} onClick={remove}>
                {t("settings.wallpaperRemove")}
              </button>
            ) : null}
          </span>
        }
      />

      {enabled && !url ? (
        <div className={bannerClass}>
          <i data-ico="info" data-size="14" aria-hidden="true" />
          <span className={isMobile ? "m-grow" : "d-grow"}>{t("settings.wallpaperBuiltinNote")}</span>
        </div>
      ) : null}
      {enabled && usingBuiltin ? (
        <div className={bannerClass}>
          <i data-ico="info" data-size="14" aria-hidden="true" />
          <span className={isMobile ? "m-grow" : "d-grow"}>{t("settings.wallpaperBuiltinActive")}</span>
        </div>
      ) : null}
      {error ? (
        <div role="alert" className={errBannerClass}>
          <i data-ico="triangle-alert" data-size="14" aria-hidden="true" />
          <span className={isMobile ? "m-grow" : "d-grow"}>{error}</span>
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
              <PwRange
                id="settings-wallpaper-scrim"
                value={scrim}
                displayValue={`${scrim}%`}
                min={WALLPAPER_SCRIM_MIN}
                max={WALLPAPER_SCRIM_MAX}
                ariaLabel={t("settings.wallpaperScrim")}
                onChange={setScrim}
              />
            }
          />
          {/* 画板 D-07b「各面适配」：三面并排（桌面 `.d-grid3` / 窄屏 M-05 `.m-grid2`），
              每面一组芯片排（`.d-cats` / `.m-cats`）。 */}
          <div className={isMobile ? "m-fieldrow" : "d-field"}>
            <div className={isMobile ? "m-grid2" : "d-grid3"}>
              {areaField("settings.wallpaperAreaMessage", messageMode, setMessageMode)}
              {areaField("settings.wallpaperAreaPanel", panelMode, setPanelMode)}
              {areaField("settings.wallpaperAreaInput", inputMode, setInputMode)}
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
