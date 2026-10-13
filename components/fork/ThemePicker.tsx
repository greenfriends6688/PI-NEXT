"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { DARK_THEME_IDS, LIGHT_THEME_IDS, THEMES, type ThemeId } from "@/lib/themes-fastvibe";

/**
 * fork:fastvibe-stack (H4) —— 24 套主题的选择器。
 *
 * ## 它和上面那个「主题」三档是什么关系
 *
 * 三档（浅色 / 深色 / 跟随系统）选的是**模式**；这里选的是「那个模式下具体用哪一套」。
 * 所以本组件**同时显示两栏**（亮色 12 套 + 暗色 12 套），当前生效的那一套高亮 ——
 * 这样「跟随系统」的用户也能看见、也能改两个阵营各自的选法，而不是只有切到对应
 * 模式才看得到另一半。
 *
 * ## 为什么不复用 PwRadio
 *
 * `PwRadio` 是为「三档」那种一行放得下的场景写的（`.pw-radio` 的格子宽度按
 * 等分算）。这里是 24 项、每项要显示一个色板 —— 形态不同，硬套会让格子挤成一条。
 * 所以用 `<details>` + 两列网格：收起时只显示当前主题名与它的色板，展开才铺开
 * （24 项铺开在设置页里是半屏，默认展开会把后面的分节全推到下面）。
 *
 * ## 色板怎么画
 *
 * 每套主题四个色块：画布 / 面板 / 强调 / 正文 —— 就是 `ThemeSeed` 的四个字段。
 * **不用 `theme.tokens`**：那里面 `accent` 是 seed.muted（见 `theme-bridge.ts`
 * 的注释），拿它当色板的「强调色」会显示成灰的，与用户切过去之后看到的不符。
 */

/** 色板上的四格：直接读 seed，不读 tokens（理由见文件头注）。 */
function Swatches({ id }: { id: ThemeId }) {
  const seed = THEMES[id];
  const cells: Array<[string, string]> = [
    ["画布", seed.bg],
    ["面板", seed.surface],
    ["强调", seed.accent],
    ["正文", seed.fg],
  ];
  return (
    <span className="h4-swatches" aria-hidden="true">
      {cells.map(([label, color]) => (
        <span key={label} className="h4-swatch" style={{ background: color }} />
      ))}
    </span>
  );
}

function ThemeGroup({
  ids,
  currentId,
  onPick,
  title,
}: {
  ids: readonly ThemeId[];
  currentId: ThemeId;
  onPick: (id: ThemeId) => void;
  title: string;
}) {
  return (
    <div className="h4-theme-group">
      <div className="h4-theme-group-title">{title}</div>
      <div className="h4-theme-grid" role="radiogroup" aria-label={title}>
        {ids.map((id) => {
          const theme = THEMES[id];
          const on = id === currentId;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              data-theme-option={id}
              className={`h4-theme-item${on ? " is-on" : ""}`}
              onClick={() => onPick(id)}
              title={`${theme.label} · ${theme.source}`}
            >
              <Swatches id={id} />
              <span className="h4-theme-name">{theme.label}</span>
              {on ? <i data-ico="check" data-size="12" aria-hidden="true"></i> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ThemePicker() {
  const { t } = useI18n();
  const { themeId, lightId, darkId, setThemeId } = useTheme();
  const [open, setOpen] = useState(false);
  const current = THEMES[themeId];

  /* 展开时把当前那一项滚进视野 —— 12 套里通常只在头两行，但「上次选了最后一套」
     时展开却看不见选中项，会让人以为没选上。收起状态不做这件事（没必要）。 */
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-theme-option="${themeId}"]`);
    // `block: "nearest"` —— 已经在视野里就不动，避免展开瞬间跳一下。
    el?.scrollIntoView({ block: "nearest" });
  }, [open, themeId]);

  const pick = useCallback((id: ThemeId) => { setThemeId(id); }, [setThemeId]);

  return (
    <div className="h4-theme-picker" data-open={open ? "true" : undefined}>
      <button
        type="button"
        className="h4-theme-summary"
        aria-expanded={open}
        aria-label={t("settings.themePick")}
        onClick={() => setOpen((v) => !v)}
      >
        <Swatches id={themeId} />
        <span className="h4-theme-name">{current.label}</span>
        <span className="h4-theme-source">{current.source}</span>
        <i data-ico={open ? "chevron-up" : "chevron-down"} data-size="14" aria-hidden="true"></i>
      </button>
      {open ? (
        <div className="h4-theme-list" ref={listRef}>
          <ThemeGroup ids={LIGHT_THEME_IDS} currentId={lightId} onPick={pick} title={t("settings.themeLightGroup")} />
          <ThemeGroup ids={DARK_THEME_IDS} currentId={darkId} onPick={pick} title={t("settings.themeDarkGroup")} />
        </div>
      ) : null}
      {/* 说清「现在生效的是哪一套」：两栏都摆在那里，用户点了暗色那栏而当前正用亮色时
         界面不会变 —— 不写这句就是「点了没反应」。 */}
      <p className="h4-theme-hint">{t("settings.themePickHint", { name: current.label })}</p>
    </div>
  );
}
