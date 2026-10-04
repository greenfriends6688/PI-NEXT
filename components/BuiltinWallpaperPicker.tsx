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

import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { BUILTIN_WALLPAPERS, paintingPath, type BuiltinWallpaperId } from "@/lib/wallpaper-builtin";

export function BuiltinWallpaperPicker({
  activeId,
  onPick,
  labelKey = "settings.wallpaperBuiltinPick",
}: {
  /** 当前生效的内置画作 id；null = 用的是自定义图片或皮肤自己的图。 */
  activeId: BuiltinWallpaperId | null;
  onPick: (id: BuiltinWallpaperId) => void;
  labelKey?: string;
}) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  return (
    <div className={isMobile ? "m-fieldrow" : "d-field"}>
      <span className={isMobile ? "m-t-sm" : "d-field-t"}>{t(labelKey)}</span>
      <div
        className={isMobile ? "m-col" : "d-store-grid"}
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
              <span
                className={isMobile ? "m-store-cover" : "d-store-cover"}
                style={{
                  backgroundImage: `url(${paintingPath(item.id)})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
              />
              <span className={isMobile ? "m-t-sm" : "d-store-card-t"}>{t(item.labelKey)}</span>
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
