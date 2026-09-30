"use client";

/**
 * fork:zn-19-merge — 内置壁纸选择器（壁纸区块与主题皮肤工作室共用）。
 *
 * 之前只有设置里的「壁纸」区块能挑这两张内置画作，进工作室给皮肤配图时挑不到，
 * 用户得退出去、在另一块 UI 里挑、再回来——这正是「三处 UI 各管一段」的由来。
 * 抽成组件后两个入口用同一份列表、同一套选中态。
 *
 * fork:design-system —— 缩略格用画板 40 的 `.pw-wallpaper-thumb`（64×36、发丝边框、
 * 圆角 4）；选中态画板没画，接线块补一条 accent 描边（登记同会话行扫掠线的
 * 「画板未画的产品状态」）。
 */

import { useI18n } from "@/hooks/useI18n";
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
  return (
    <div className="pw-field">
      <span className="pw-label">{t(labelKey)}</span>
      <span className="pw-inline" role="group" aria-label={t(labelKey)} style={{ flexWrap: "wrap" }}>
        {BUILTIN_WALLPAPERS.map((item) => {
          const active = activeId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`pw-wallpaper-thumb${active ? " is-on" : ""}`}
              style={{ backgroundImage: `url(${paintingPath(item.id)})` }}
              title={t(item.labelKey)}
              aria-label={t(item.labelKey)}
              aria-pressed={active}
              onClick={() => onPick(item.id)}
            />
          );
        })}
      </span>
    </div>
  );
}

/** 把一张壁纸 URL 反查回内置画作 id（皮肤存的是路径，全局存的是 id）。 */
export function builtinIdForWallpaperUrl(url: string | null | undefined): BuiltinWallpaperId | null {
  if (!url) return null;
  const match = BUILTIN_WALLPAPERS.find((item) => url.endsWith(paintingPath(item.id)));
  return match ? match.id : null;
}
