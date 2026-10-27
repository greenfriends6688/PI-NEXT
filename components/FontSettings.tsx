"use client";

import { Fragment } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useFontPreferences } from "@/hooks/useFontPreferences";
import { FONT_FAMILY_MAX_LENGTH, FONT_WEIGHT_DEFAULT, FONT_WEIGHT_OPTIONS } from "@/lib/font-preferences";

const FONT_FIELDS = [
  { kind: "ui", label: "settings.uiFontFamily", placeholder: "settings.uiFontPlaceholder", reset: "settings.resetUiFont", weightLabel: "settings.uiFontWeight" },
  { kind: "mono", label: "settings.monoFontFamily", placeholder: "settings.monoFontPlaceholder", reset: "settings.resetMonoFont", weightLabel: "settings.monoFontWeight" },
] as const;

/**
 * The two font rows of the Fonts & layout section, as the board's `.crow` rows
 * (design/v3/boards/web-settings-general.html 的「界面字体」卡)：标题是这一行管什么，
 * 次级文字是字重、跟着滑杆走；行尾依次是名字输入（`.field` 外壳）、字重滑杆和重置（`.btn`）。
 * 名字输入用它所命名的字体渲染，所以它同时就是预览。两行之间补 `.cdivider`，由调用方的
 * `.card` 收成一张卡 —— 与画板 `.card` 里的一串 `.crow` 同构。
 */
export function FontSettings() {
  const { t } = useI18n();
  const fonts = useFontPreferences();

  return (
    <>
      {FONT_FIELDS.map(({ kind, label, placeholder, reset, weightLabel }, index) => {
        const weight = fonts[`${kind}Weight`];
        const weightIndex = FONT_WEIGHT_OPTIONS.findIndex((option) => option.value === weight);
        return (
          <Fragment key={kind}>
            {index > 0 && <div className="cdivider" />}
            <div className="crow">
              <div className="crow__text">
                <div className="crow__title">
                  <label htmlFor={`settings-font-${kind}`}>{t(label)}</label>
                </div>
                {/* 字重名跟着滑杆走：写成 `<output>`，滑杆一动它就跟着更新。 */}
                <output
                  className="crow__detail"
                  htmlFor={`settings-font-${kind}-weight`}
                  title={`${t(weightLabel)}: ${weight}`}
                >
                  {t(weightLabel)} · {t(FONT_WEIGHT_OPTIONS[weightIndex].label)}
                </output>
              </div>
              <div className="crow__control">
                <span className="field settings-font-field">
                  <input
                    id={`settings-font-${kind}`}
                    className={`settings-font-input${kind === "mono" ? " is-mono" : ""}`}
                    type="text"
                    value={fonts[kind]}
                    placeholder={t(placeholder)}
                    maxLength={FONT_FAMILY_MAX_LENGTH}
                    aria-describedby="settings-typography-description"
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(event) => fonts.setFontPreference(kind, event.target.value)}
                  />
                </span>
                <input
                  id={`settings-font-${kind}-weight`}
                  type="range"
                  min={FONT_WEIGHT_OPTIONS[0].value}
                  max={FONT_WEIGHT_OPTIONS[FONT_WEIGHT_OPTIONS.length - 1].value}
                  step={100}
                  value={weight}
                  aria-label={t(weightLabel)}
                  aria-valuetext={`${weight} ${t(FONT_WEIGHT_OPTIONS[weightIndex].label)}`}
                  onChange={(event) => fonts.setFontWeight(kind, Number(event.target.value))}
                />
                <button
                  type="button"
                  className="btn"
                  title={t(reset)}
                  aria-label={t(reset)}
                  disabled={!fonts[kind] && weight === FONT_WEIGHT_DEFAULT}
                  onClick={() => fonts.resetFontPreference(kind)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />
                  </svg>
                </button>
              </div>
            </div>
          </Fragment>
        );
      })}
    </>
  );
}
