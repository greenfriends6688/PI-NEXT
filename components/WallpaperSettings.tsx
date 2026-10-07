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
 * fork:wallpaper-upload-not-builtin（2026-10-07 · 用户实拍）—— 撤掉这里的内置壁纸
 * 画廊（`BuiltinWallpaperPicker`）。用户原话：「当我开启壁纸后，应该让我上传壁纸，
 * 而不是直接显示内置壁纸，因为我上面有内置的主题了」—— 内置主题在**上面**的主题
 * 皮肤条里已有一份，画廊摆在这儿等于同一个东西出现两次。开启壁纸后这一节要让人
 * 上传 / 选择自己的图，也就是「当前壁纸」那一行的「选择图片」。
 *
 * 这一处原先是 fork:v5-wallpaper-gallery 按画板 D-07b（五行里最后一段「内置壁纸」
 * 画廊）挂上去的。画廊的另一个入口在皮肤工作室里（`ThemeSkinStudio` 仍挂
 * `BuiltinWallpaperPicker`），能力没丢；代价是设置里不能再覆盖「用哪张内置画作」——
 * 主题会按调色板自动配一张（`builtinPaintingFor`）。这条对画板 D-07b 的让步已写进
 * 报告（本轮文件范围未含 `design/v5/DIVERGENCE.md`，待其宿主补登）。
 *
 * fork:wallpaper-no-explainer（2026-10-07 · 用户实拍）—— 「这种副标题也就是解释
 * 说明的也给我去掉吧」。本组件里三条纯解释句退场：块首的 `wallpaperDescription`
 * （「在工作区后面放一张图片…」）、「显示壁纸」行的 `WALLPAPER_ENABLED_HINT`
 * （「关掉时下面两行整块消失…」）、「当前壁纸」行的 `WALLPAPER_CURRENT_HINT`
 * （「没选过图时这一行只有「选择图片」…」）。口径见 DIVERGENCE §W：设置面只留
 * 控件标签 / 当前值状态 / 会阻止动作的信息，纯解释「这个设置是什么、为什么这么
 * 设计」的整句一律删；对应 i18n 键三语同步清掉，不留死键。
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

/* fork:wallpaper-no-explainer（2026-10-07 用户裁定）—— 「各面适配」下那句「为什么用
   芯片排而不用下拉」是**纯解释**（设置面只留控件标签 / 当前值 / 会阻止动作的信息，
   见 DIVERGENCE §W），整条退场；字段标题 `WALLPAPER_AREA_TITLE` 保留。 */

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
    scrim,
    inputMode,
    panelMode,
    messageMode,
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
      <PwField
        label={t("settings.wallpaperEnabled")}
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

      {/* fork:wallpaper-no-explainer（2026-10-07）—— 两条横幅的条件完全等价
          （`enabled && !url` ↔ `usingBuiltin`），内容也都在说「当前显示的是内置画作」。
          留一条（措辞更清楚的那一条），删掉 `wallpaperBuiltinActive` 与它的三语 key。 */}
      {enabled && !url ? (
        <div className={bannerClass}>
          <i data-ico="info" data-size="14" aria-hidden="true" />
          <span className={isMobile ? "m-grow" : "d-grow"}>{t("settings.wallpaperBuiltinNote")}</span>
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
          {/* 画板 D-07b「各面适配」：标题 + 三个并排的芯片组（`.d-grid3`；手机档
              M-05 是 `.m-grid2`，那边不动）。fork:wallpaper-no-explainer —— 标题下面那句
              「为什么用芯片排」的判据退场（纯解释）。 */}
          <div className={isMobile ? "m-fieldrow" : "d-field"}>
            <span className={isMobile ? "m-t-sm" : "d-field-t"}>{localCopy(WALLPAPER_AREA_TITLE, locale)}</span>
            <div className={isMobile ? "m-grid2" : "d-grid3"}>
              {areaField("settings.wallpaperAreaMessage", messageMode, setMessageMode)}
              {areaField("settings.wallpaperAreaPanel", panelMode, setPanelMode)}
              {areaField("settings.wallpaperAreaInput", inputMode, setInputMode)}
            </div>
          </div>
        </>
      ) : null}

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
