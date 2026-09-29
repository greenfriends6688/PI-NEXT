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

import { useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  DEFAULT_THEME_SKIN,
  THEME_SKIN_DEFAULT_ID,
  parseSkinImport,
  serializeSkinForExport,
  type ThemeSkin,
} from "@/lib/theme-skins";
import { BUILTIN_SKIN_LABEL_KEYS } from "@/lib/builtin-skins";

function SkinCardArt({ skin }: { skin: ThemeSkin | null }) {
  if (!skin) {
    // 默认皮肤：不写内联，`.a` / `.b` 用 board.css 的面板色与画布色。
    return <span className="prev"><span className="a" /><span className="b" /></span>;
  }
  return (
    <span className="prev">
      <span className="a" style={{ background: skin.panel }} />
      <span className="b" style={{ background: skin.background }} />
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
                  <span className="pw-ico"><i data-ico="check" data-size="12" aria-hidden="true" /></span>
                ) : null}
                {label}
              </span>
            </button>
          );
        })}

        <button type="button" className="pw-skin is-new" disabled={busy} onClick={onCreate}>
          <span className="pw-btn sm">
            <span className="pw-ico"><i data-ico="plus" data-size="13" aria-hidden="true" /></span>
            {t("settings.skinNew")}
          </span>
        </button>
      </div>

      <div className="pw-inline pw-skin-actions">
        <button type="button" className="pw-btn outline sm" onClick={() => fileInputRef.current?.click()}>
          <span className="pw-ico"><i data-ico="upload" data-size="13" aria-hidden="true" /></span>
          {t("settings.skinImport")}
        </button>
        <button
          type="button"
          className="pw-btn outline sm"
          disabled={activeSkin === null}
          onClick={() => activeSkin && onExport(activeSkin)}
        >
          <span className="pw-ico"><i data-ico="download" data-size="13" aria-hidden="true" /></span>
          {t("settings.skinExport")}
        </button>
        <button
          type="button"
          className="pw-btn outline sm"
          disabled={activeSkin === null}
          onClick={() => activeSkin && onEdit(activeSkin.id)}
        >
          <span className="pw-ico"><i data-ico="paintbrush" data-size="13" aria-hidden="true" /></span>
          {t("settings.skinStudio")}
        </button>
        <span className="pw-grow" />
        <span className="pw-mono pw-dim">{t("settings.skinNote")}</span>
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
