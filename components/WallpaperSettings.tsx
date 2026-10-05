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
 * fork:v5-wallpaper-gallery（本轮补的第三处缺口）—— 画板 D-07b「默认外观壁纸」块
 * 有**五行**，产品先前只有四行：缺的是最后那段「内置壁纸」画廊
 * （`.d-field` + `.d-store-grid` / `.d-store-card`，三格：两张内置画作 + 一格
 * 「自己带图」）。产品其实有这份组件（`BuiltinWallpaperPicker`，工作室在用），
 * 只是设置页这一处没挂 —— 于是「内置画作」在设置里只能看到两条说明横幅
 * （`wallpaperBuiltinNote` / `wallpaperBuiltinActive`），没有可点的入口。
 * 画板那段的约定「两个入口共用一份列表，不各挑一次」正是这个组件的由来，所以
 * 这里直接接它，不再造第二份清单。窄屏（M-05）走同一个组件的 `m-storecard`。
 *
 * 画板第三格「自己带图（JPEG / PNG / WebP · SVG 有意拒绝）」由上面那行的
 * 「选择图片」承担：它的 MIME 白名单与体积上限就是那三句话的实现
 * （`WALLPAPER_MIME_TYPES` / `fileToWallpaperDataUrl`），不另画一格点同一个动作。
 *
 * 图片是用户数据（data URL），缩略图用 `<img>` 而不是 `background-image`（前者
 * 才能套 `ImagePreview` 点开看全图）；几何与边框来自形态表的 `.d-thumb`。
 */

import { useRef, useState, type ChangeEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useWallpaper } from "@/hooks/useWallpaper";
import { localCopy, type LocalCopy } from "./settings-disabled-reasons";
import { PwField, PwSwitch, stateBadge } from "./SettingsUi";
import { ImagePreview } from "./ImagePreview";
import { BuiltinWallpaperPicker, GALLERY_HINT } from "./BuiltinWallpaperPicker";
import { BUILTIN_WALLPAPERS, type BuiltinWallpaperId } from "@/lib/wallpaper-builtin";
import {
  WALLPAPER_SCRIM_MAX,
  WALLPAPER_SCRIM_MIN,
  WALLPAPER_MIME_TYPES,
  type WallpaperAreaMode,
} from "@/lib/wallpaper";

const AREA_MODES: WallpaperAreaMode[] = ["none", "trans", "blur"];

/* fork:v5-landing-frame · D-07b 帧 A —— 「各面适配」字段的标题与那句判据。
   板面上写着，语言包里没有（`lib/i18n/**` 不在本轮文件范围），走本地表
   （与 `settings-disabled-reasons` 同一口径）。 */
const WALLPAPER_AREA_TITLE: LocalCopy = {
  en: "Per-surface fit",
  "zh-CN": "各面适配",
  "zh-TW": "各面適配",
};

const WALLPAPER_AREA_HINT: LocalCopy = {
  en: "Letting the wallpaper reach everything makes dense surfaces such as the composer and code blocks hard to read, so each of the three surfaces picks its own level. Chips rather than a dropdown, because a dropdown folds the other two levels behind one arrow.",
  "zh-CN": "壁纸铺满一切会让输入框与代码块这类密排面读不清，所以三个面各自选一档；用芯片排而不用下拉，是因为下拉把另外两档折进了一个箭头里。",
  "zh-TW": "桌布鋪滿一切會讓輸入框與程式碼區塊這種密排面讀不清，所以三個面各自選一檔；用晶片排而不用下拉，因為下拉把另外兩檔摺進了一個箭頭裡。",
};

/* 板面上那两行的说明（`d-set-row-s`）：第一行解释「关掉时下面两行整块消失」，
   第二行解释「没选过图时只有选择图片」。 */
const WALLPAPER_ENABLED_HINT: LocalCopy = {
  en: "Turning it off makes the two rows below (overlay strength / per-surface fit) disappear — they drive the wallpaper, and without a wallpaper there is nothing to adjust.",
  "zh-CN": "关掉时下面两行（遮罩浓度 / 各面适配）整块消失 —— 它们驱动的是壁纸，没有壁纸就没有可调的东西。",
  "zh-TW": "關掉時下面兩列（遮罩濃度 / 各面適配）整塊消失 —— 它們驅動的是桌布，沒有桌布就沒有可調的東西。",
};

const WALLPAPER_CURRENT_HINT: LocalCopy = {
  en: "Before an image is picked this row only has “Choose image”; afterwards it also has “Replace” and “Remove”. An image over the limit gets a reason you can act on.",
  "zh-CN": "没选过图时这一行只有「选择图片」；选过之后才有「更换」与「移除」。图片超限会给出可执行的原因。",
  "zh-TW": "沒選過圖時這一行只有「選擇圖片」；選過之後才有「更換」與「移除」。圖片超限會給出可執行的原因。",
};



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
  const { locale, t } = useI18n();
  const isMobile = useIsMobile();
  const bannerClass = isMobile ? "m-banner" : "d-banner info";
  const errBannerClass = isMobile ? "m-banner" : "d-banner err";
  const btnClass = isMobile ? "m-btn" : "d-btn sm";
  const {
    enabled,
    url,
    builtin,
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
    setBuiltin,
  } = useWallpaper();

  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** 当前选中的内置画作 id；空串 = 用户自己的图片（或主题自带的画作）。画廊的
      选中态读它，所以这一处就是「哪一张内置画作在使用中」的唯一真值。 */
  const activeBuiltinId: BuiltinWallpaperId | null = BUILTIN_WALLPAPERS.some((item) => item.id === builtin)
    ? (builtin as BuiltinWallpaperId)
    : null;

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
      /* fork:v5-landing-frame · D-07b 帧 A —— 接管态原文：`.d-banner.warn` +
         `.d-btn.sm.ghost.d-banner-btn`（板面那枚按钮带 `.d-banner-btn`，右对齐靠它）。 */
      <div className={isMobile ? "m-banner" : "d-banner warn"}>
        <i data-ico="info" data-size="14" aria-hidden="true" />
        <span className={isMobile ? "m-grow" : "d-grow"}>{t("settings.wallpaperSkinOwned")}</span>
        {onEditSkin ? (
          <button
            type="button"
            className={isMobile ? "m-btn sm ghost" : "d-btn sm ghost d-banner-btn"}
            onClick={onEditSkin}
          >
            {t("settings.wallpaperSkinOwnedEdit")}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <>
      {/* fork:v5-landing-frame · D-07b 帧 A —— 块首那句弱化说明（板面原文，单独一行，
          不是第一行的 `d-set-row-s`）：先说清「遮罩是谁做的」，后面几行才读得懂。 */}
      <div className={isMobile ? "m-t-xs m-t-faint" : "d-t-xs d-t-faint"}>
        {t("settings.wallpaperDescription")}
      </div>

      <PwField
        label={t("settings.wallpaperEnabled")}
        hint={localCopy(WALLPAPER_ENABLED_HINT, locale)}
        /* fork:v5-landing-frame · D-07b 帧 A —— 「显示壁纸」那一行原文是
           `.d-grow-last > .d-badge.ok`（开）+ 行尾开关；并且画板明确写着「关掉时下面
           遮罩浓度 / 各面适配整块消失」—— 产品一直就是按 `enabled` 条件挂那两段的。 */
        badge={stateBadge(locale, enabled)}
        control={
          <PwSwitch
            checked={enabled}
            label={t("settings.wallpaperEnabled")}
            onChange={setEnabled}
          />
        }
      />

      {/* 画板 D-07b 的「当前壁纸」行：缩略图 + 更换 / 移除。画板原文两态都有这一格
          （缺了它这行右侧会随状态忽长忽短），但没选图时那格写着「壁纸占位」四个字：
          在设置栏的实际宽度里这四个字被压成竖排一列，比旁边那枚按钮还抢眼
          （2026-10-05 用户判「这个占位突兀」→ 只留图标；画板没动，产品侧的偏离）。
          图标外面再包一层 span —— 不包的话 `.d-thumb > i` 会把它拉成整格宽，
          贴着左边而不是居中。有图时那格包 `ImagePreview`：16:9 的缩略图看不清细节，
          点一下开灯箱看全图（聊天里点图放大是同一个组件）。 */}
      <PwField
        label={t("settings.wallpaperCurrent")}
        hint={localCopy(WALLPAPER_CURRENT_HINT, locale)}
        control={
          <span className="d-row">
            {url ? (
              <span className="d-thumb">
                <ImagePreview
                  src={url}
                  alt={t("settings.wallpaperCurrent")}
                  style={{ width: "100%", height: "100%" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- data URL，走不了 image optimizer */}
                  <img
                    src={url}
                    alt=""
                    style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </ImagePreview>
              </span>
            ) : (
              <span className="d-thumb d-placeholder">
                <span><i data-ico="image" data-size="16" aria-hidden="true" /></span>
              </span>
            )}
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
            /* fork:v5-landing-frame · D-07b 帧 A —— 「遮罩浓度」那一行原文：
               `.d-grow-last > .d-badge.mute`（36%）+ 行尾 `.d-slider`。 */
            badge={{ text: `${scrim}%`, tone: "mute" }}
            slider={{
              id: "settings-wallpaper-scrim",
              value: scrim,
              min: WALLPAPER_SCRIM_MIN,
              max: WALLPAPER_SCRIM_MAX,
              ariaLabel: t("settings.wallpaperScrim"),
              onChange: setScrim,
            }}
            control={null}
          />
          {/* 画板 D-07b「各面适配」：标题 + 一句为什么用芯片排（三面并排，
              `.d-grid3`；手机档 M-05 是 `.m-grid2`，那边不动）。此前产品只有三个
              并排的芯片组，没有字段标题与那句判据。 */}
          <div className={isMobile ? "m-fieldrow" : "d-field"}>
            <span className={isMobile ? "m-t-sm" : "d-field-t"}>{localCopy(WALLPAPER_AREA_TITLE, locale)}</span>
            <span className={isMobile ? "m-t-xs m-t-faint" : "d-t-xs d-t-faint"}>
              {localCopy(WALLPAPER_AREA_HINT, locale)}
            </span>
            <div className={isMobile ? "m-grid2" : "d-grid3"}>
              {areaField("settings.wallpaperAreaMessage", messageMode, setMessageMode)}
              {areaField("settings.wallpaperAreaPanel", panelMode, setPanelMode)}
              {areaField("settings.wallpaperAreaInput", inputMode, setInputMode)}
            </div>
          </div>
        </>
      ) : null}

      {/* fork:v5-wallpaper-gallery —— 画板 D-07b 壁纸块最后一段「内置壁纸」：
          画廊与皮肤工作室共用同一份列表（`BuiltinWallpaperPicker`），选完立刻生效。
          它不属于「开了壁纸才有意义」那一组：内置画作在没有用户图片时就是当前壁纸，
          所以整块常驻（画板也是常驻）。 */}
      <BuiltinWallpaperPicker
        activeId={activeBuiltinId}
        onPick={(id) => setBuiltin(id)}
        hint={localCopy(GALLERY_HINT, locale)}
      />

      {/* fork:v5-landing-frame · D-07b 帧 A —— 隐藏的取色/选图 `<input type=file>` 挪到
          块尾：板面上它不在 DOM 里（选图由那一行的按钮触发），但产品必须有它才能真的
          打开系统文件选择器，所以它留在最后 —— 让前面每一段与板面逐节点对得上。 */}
      <input
        ref={fileRef}
        type="file"
        accept={WALLPAPER_MIME_TYPES.join(",")}
        className="sr-only"
        aria-label={t("settings.wallpaperChoose")}
        onChange={(event) => void onFile(event)}
      />
    </>
  );
}
