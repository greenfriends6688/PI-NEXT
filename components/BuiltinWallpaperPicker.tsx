"use client";

/**
 * fork:zn-19-merge — 内置壁纸选择器（壁纸区块与主题皮肤工作室共用）。
 *
 * 之前只有设置里的「壁纸」区块能挑这两张内置画作，进工作室给皮肤配图时挑不到，
 * 用户得退出去、在另一块 UI 里挑、再回来——这正是「三处 UI 各管一段」的由来。
 * 抽成组件后两个入口用同一份列表、同一套选中态。
 *
 * fork:design-system —— 缩略格用画板 D-07b 的 `.d-store-grid` / `.d-store-card` /
 * `.d-store-cover`；选中态画板没画，接线块补一条 accent 描边（登记同会话行扫掠线的
 * 「画板未画的产品状态」）。窄屏（M-05）走同一张表的 `.m-storecard` / `.m-store-cover`
 * 竖排。
 *
 * fix:board47-caption（2026-09-30）—— 每格下面补一行等宽画名。
 * 画板 47 帧 3 的画廊格是「图 + 等宽画名」两段（`纸纹 · 当前`），名字是常驻文字；
 * 产品原来只把它塞进 `title=`/`aria-label`，肉眼比不出两张画。画板那个「· 当前」
 * 后缀没有对应的 i18n 键（不硬造中文），选中态继续由 accent 描边 + `aria-pressed` 表达。
 *
 * **仍是行内而不是模态画廊**（判给用户）：画板那帧的右半是一个**独立模态**
 * （壳 + 六格 + 取消/应用），而工作室里壁纸这一段画的是
 * 行内的「选择图片 / 移除」。产品在工作室里就属于后者：这里的每一次选择都要
 * 立刻反映到左边的实时预览上（帧 2 的约定「预览是唯一实时的东西」），套一层带
 * 「应用」的模态会把这条约定反过来。再叠一层模态还要处理焦点陷阱套焦点陷阱。
 * 代价记在报告里，等拍板。
 */

import type { ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { localCopy, type LocalCopy } from "./settings-disabled-reasons";
import { BUILTIN_WALLPAPERS, paintingPath, type BuiltinWallpaperId } from "@/lib/wallpaper-builtin";

/* fork:v5-landing-frame · D-07b 帧 A —— 每格下面那一句冷调 / 暖调说明与页脚的两个状态
   文案。板面上写着，语言包里没有（`lib/i18n/**` 不在本轮文件范围），走本地表。 */
const BUILTIN_WALLPAPER_NOTES: Partial<Record<BuiltinWallpaperId, LocalCopy>> = {
  "zhang-ruonan": {
    en: "Warm · mid tones, suits the light theme",
    "zh-CN": "暖调 · 中间调，适合浅色",
    "zh-TW": "暖調 · 中間調，適合淺色",
  },
  "cai-xukun": {
    en: "Cool · lots of highlights, suits the dark theme",
    "zh-CN": "冷调 · 亮部多，适合深色",
    "zh-TW": "冷調 · 亮部多，適合深色",
  },
};

/** 目录里新增一张画时忘了补说明时的兜底（不给空行）。 */
const BUILTIN_WALLPAPER_NOTE_FALLBACK: LocalCopy = {
  en: "Built-in painting",
  "zh-CN": "内置画作",
  "zh-TW": "內建畫作",
};

const GALLERY_FOOT_IN_USE: LocalCopy = {
  en: "In use",
  "zh-CN": "使用中",
  "zh-TW": "使用中",
};

const GALLERY_FOOT_IDLE: LocalCopy = {
  en: "Not in use",
  "zh-CN": "未选用",
  "zh-TW": "未選用",
};

/** 「与主题配套的两张画作…两个入口共用一份，不各挑一次」—— 板面那句字段说明。 */
export const GALLERY_HINT: LocalCopy = {
  en: "Two paintings that ship with the theme, nothing to download. The studio uses this same list when it picks an image for a skin — one list, not one pick per entry point.",
  "zh-CN": "与主题配套的两张画作，不用下载。工作室给皮肤配图时也是这同一份列表 —— 两个入口共用一份，不各挑一次。",
  "zh-TW": "與主題配套的兩張畫作，不用下載。工作室給皮膚配圖時也是這同一份清單 —— 兩個入口共用一份，不各挑一次。",
};

export function BuiltinWallpaperPicker({
  activeId,
  onPick,
  labelKey = "settings.wallpaperBuiltinPick",
  hint,
}: {
  /** 当前生效的内置画作 id；null = 用的是自定义图片或皮肤自己的图。 */
  activeId: BuiltinWallpaperId | null;
  onPick: (id: BuiltinWallpaperId) => void;
  labelKey?: string;
  /** fork:v5-landing-frame · D-07b 帧 A —— 字段下那句判据（板面原文）。工作室里这一段
   *  不给（那里有别的一句），所以做成可选的节点而不是固定文案。 */
  hint?: ReactNode;
}) {
  const { locale, t } = useI18n();
  const isMobile = useIsMobile();
  return (
    <div className={isMobile ? "m-fieldrow" : "d-field"}>
      <span className={isMobile ? "m-t-sm" : "d-field-t"}>{t(labelKey)}</span>
      {hint ? (
        <span className={isMobile ? "m-t-xs m-t-faint" : "d-t-xs d-t-faint"}>{hint}</span>
      ) : null}
      <div
        className={isMobile ? "m-grid2" : "d-store-grid"}
        role="group"
        aria-label={t(labelKey)}
      >
        {BUILTIN_WALLPAPERS.map((item) => {
          const active = activeId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`${isMobile ? "m-storecard" : "d-store-card"}${active ? " is-on" : ""}`}
              title={t(item.labelKey)}
              aria-label={t(item.labelKey)}
              aria-pressed={active}
              onClick={() => onPick(item.id)}
            >
              {/* fork:v5-landing-frame · D-07b 帧 A —— 画板那一格是四段：
                  `.d-store-cover`（图标）/ `.d-store-card-t`（画名）/
                  `.d-t-xs.d-t-faint`（一句冷暖与适合的主题）/ `.d-grow` /
                  `.d-store-foot`（「未选用」或 `.d-badge.ok`「使用中」）。
                  产品此前只有前两段，两张画除了画名什么都读不出来。
                  第三格「自己带图（JPEG / PNG / WebP · SVG 有意拒绝）」是**同一个动作**
                  的另一入口 —— 设置块那一行的「选择图片」就是它（同一份 MIME 白名单与体积
                  上限），不另画一格点同一个动作。 */}
              {/* 板面原文用的是 `div`（`div.d-store-cover` / `div.d-store-card-t` /
                  `div.d-t-xs.d-t-faint` / `div.d-grow` / `div.d-store-foot`），产品此前
                  发的是 `span`（button 的内容模型是 phrasing content）。铁律一：抄 DOM
                  原文 —— 与 `d-store-card` 里其它几格保持一致，都按板面走。 */}
              <div
                className={isMobile ? "m-store-cover" : "d-store-cover"}
                style={{
                  backgroundImage: `url(${paintingPath(item.id)})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
              />
              <div className={isMobile ? "m-t-sm" : "d-store-card-t"}>{t(item.labelKey)}</div>
              {!isMobile ? (
                <>
                  <div className="d-t-xs d-t-faint">
                    {localCopy(BUILTIN_WALLPAPER_NOTES[item.id] ?? BUILTIN_WALLPAPER_NOTE_FALLBACK, locale)}
                  </div>
                  <div className="d-grow" aria-hidden="true" />
                  <div className="d-store-foot">
                    {active ? (
                      <span className="d-badge ok">{localCopy(GALLERY_FOOT_IN_USE, locale)}</span>
                    ) : (
                      <span>{localCopy(GALLERY_FOOT_IDLE, locale)}</span>
                    )}
                  </div>
                </>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 把一张壁纸 URL 反查回内置画作 id（皮肤存的是路径，全局存的是 id）。 */
export function builtinIdForWallpaperUrl(url: string | null | undefined): BuiltinWallpaperId | null {
  if (!url) return null;
  const match = BUILTIN_WALLPAPERS.find((item) => url.endsWith(paintingPath(item.id)));
  return match ? match.id : null;
}
