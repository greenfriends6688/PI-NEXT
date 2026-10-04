"use client";

/**
 * fork:design-system SW-07 — 主题皮肤条，改用画板 47 的 `.pw-skin-strip` / `.pw-skin`。
 *
 * 画板里这一组是：一排 `.pw-skin` 卡（选中卡 `.is-on`，卡面 `.prev` 是
 * `.a`（侧栏色）+ `.b`（内容底色）两块，卡底 `.cap` 放勾选图标与名字），末位一张
 * 「新建皮肤」卡；卡下面是 `.pw-inline` 动作行（导入 / 导出 / 打开皮肤工作室）。
 *
 * 三处产品侧适配（都在 `app/fork-ui.css` 的接线块里，规格仍只有 board.css 一个来源）：
 * - 卡与动作钮在画板里是 div/span，产品是 button（UA 归零 + 可聚焦）；
 * - 画板是固定 5 张的静态行，产品皮肤数量不定 → `.pw-skin-strip` 横向可滚动；
 * - 卡里放的是 span 而不是 div（button 的内容模型是 phrasing content）。
 *
 * 预览里的颜色是**这套皮肤的值**，不是主题的值，所以只能内联；默认皮肤不带值，
 * 不写内联，直接落回 board.css 的 `.a/.b` token。
 *
 * 原实现（fork:zn-19）是一条带左右滚动按钮的 Zeno 卡带，还画了壁纸与玻璃面板缩略图；
 * 画板 47 只画两块色，按「画板即规格」收敛掉。
 */

import { useRef, type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  DEFAULT_THEME_SKIN,
  THEME_SKIN_DEFAULT_ID,
  parseSkinImport,
  serializeSkinForExport,
  type ThemeSkin,
} from "@/lib/theme-skins";
import { BUILTIN_SKIN_LABEL_KEYS } from "@/lib/builtin-skins";

/* fix:skin-card-wallpaper —— 内置皮肤（蔡徐坤 / 章若楠）的四个基色是**故意留空**的
   （继承主题配色，见 lib/builtin-skins.ts），它们唯一的标识就是那张画。原来只把
   基色铺进卡面，于是空值回落成 `--n-panel` / `--n-canvas` 两块主题色 —— 两张卡
   看起来就是空白的（用户实测「为什么不显示图片」）。
   现在：`.a`（22px 侧栏列）仍是面板色，`.b`（内容列）有画就铺画（cover），
   没画才铺底色 —— 画板的 `grid-template-columns: 22px 1fr` 结构不变。
   抽成纯函数是为了让这条判据有一处可测（components/ThemeSkinStrip.test.mjs）。 */
export function skinCardPaint(skin: ThemeSkin | null): {
  a: CSSProperties | undefined;
  b: CSSProperties | undefined;
} {
  if (!skin) return { a: undefined, b: undefined };
  const wallpaper = skin.wallpaper?.trim();
  return {
    a: skin.panel ? { background: skin.panel } : undefined,
    b: wallpaper
      ? { backgroundImage: `url("${wallpaper}")`, backgroundSize: "cover", backgroundPosition: "center" }
      : skin.background ? { background: skin.background } : undefined,
  };
}

function SkinCardArt({ skin }: { skin: ThemeSkin | null }) {
  const paint = skinCardPaint(skin);
  return (
    <span className="prev">
      <span className="a" style={paint.a} />
      <span className="b" style={paint.b} />
    </span>
  );
}

export function ThemeSkinStrip({
  skins,
  activeId,
  onSelect,
  onCreate,
  onEdit,
  onImport,
  onExport,
  busy = false,
}: {
  skins: ThemeSkin[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onEdit: (id: string) => void;
  onImport: (skin: ThemeSkin) => void;
  onExport: (skin: ThemeSkin) => void;
  busy?: boolean;
}) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeSkin = activeId === THEME_SKIN_DEFAULT_ID
    ? null
    : skins.find((skin) => skin.id === activeId) ?? null;

  const handleImportFile = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    const skin = parseSkinImport(text);
    if (skin) onImport(skin);
  };

  return (
    <>
      {/* fork:v5-landing 口径 —— `pw-skin-strip` / `pw-skin` 暂时保留：v5 全库没有
          皮肤条的画板（D-07 帧 A 把皮肤入口画成一张 `.d-setcard` 弹层，改成那个
          会删掉行内换肤行为），且 `board-specs/4x-47-frame*.mjs` 仍把它们当选择器。
          条外的动作行与文案已换 `d-*`。 */}
      <div className="pw-skin-strip" role="radiogroup" aria-label={t("settings.skinLibrary")}>
        {[null, ...skins].map((skin) => {
          const id = skin?.id ?? THEME_SKIN_DEFAULT_ID;
          // fork:zn-19-builtin-skins — 内置皮肤没写死名字（跨语言会错），标题按 id 取目录。
          const label = skin
            ? (BUILTIN_SKIN_LABEL_KEYS[skin.id] ? t(BUILTIN_SKIN_LABEL_KEYS[skin.id]) : skin.name)
            : t("settings.skinDefault");
          const selected = activeId === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={label}
              disabled={busy}
              className={`pw-skin${selected ? " is-on" : ""}`}
              onClick={() => onSelect(id)}
            >
              <SkinCardArt skin={skin} />
              <span className="cap">
                {selected ? (
                  <i data-ico="check" data-size="12" aria-hidden="true" />
                ) : null}
                {label}
              </span>
            </button>
          );
        })}

        <button type="button" className="pw-skin is-new" disabled={busy} onClick={onCreate}>
          <span className="d-btn sm">
            <i data-ico="plus" data-size="13" aria-hidden="true" />
            {t("settings.skinNew")}
          </span>
        </button>
      </div>

      <div className="d-row">
        <button type="button" className="d-btn sm" onClick={() => fileInputRef.current?.click()}>
          <i data-ico="upload" data-size="13" aria-hidden="true" />
          {t("settings.skinImport")}
        </button>
        <button
          type="button"
          className="d-btn sm"
          disabled={activeSkin === null}
          // fork:fix-disabled-title（2026-10-01）—— 禁用原因写 title（不写功能名）。
          // 默认外观下 activeSkin 为 null：它不是一份皮肤文件，既导不出也进不了工作室。
          title={activeSkin === null ? t("settings.skinActionsNeedCustom") : t("settings.skinExport")}
          onClick={() => activeSkin && onExport(activeSkin)}
        >
          <i data-ico="download" data-size="13" aria-hidden="true" />
          {t("settings.skinExport")}
        </button>
        <button
          type="button"
          className="d-btn sm"
          disabled={activeSkin === null}
          title={activeSkin === null ? t("settings.skinActionsNeedCustom") : t("settings.skinStudio")}
          onClick={() => activeSkin && onEdit(activeSkin.id)}
        >
          <i data-ico="paintbrush" data-size="13" aria-hidden="true" />
          {t("settings.skinStudio")}
        </button>
        <span className="d-grow" />
        <span className="d-t-xs d-t-faint">{t("settings.skinNote")}</span>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            void handleImportFile(event.target.files?.[0] ?? null);
            // 清空，否则连续导入同一个文件第二次不触发 change
            event.target.value = "";
          }}
        />
      </div>
    </>
  );
}

export { DEFAULT_THEME_SKIN, serializeSkinForExport };
