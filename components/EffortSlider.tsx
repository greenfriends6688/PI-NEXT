"use client";

import { useI18n } from "@/hooks/useI18n";

/**
 * design/v3/boards/web-menu-model.html 的 `.effort-card`（droppy 的 EffortSlider）：
 * 34 高轨道 + 42 玻璃滑块 + 四档刻度。产品里档位来自模型的 availableThinkingLevels，
 * 拖动 / 点刻度 / 方向键都走原生 range，键盘与触摸一起拿到。
 */
export interface EffortSliderProps {
  /** 实档位，低 → 高（不含 auto）。 */
  levels: string[];
  /** 当前实档位的下标；auto 时用解析出来的档位。 */
  value: string | null;
  /** 标题：当前档位的显示名，auto 时是「自动」。 */
  label: string;
  auto: boolean;
  /** 有值就显示「回到默认」那颗钮。 */
  defaultLevel?: string | null;
  onChange: (level: string) => void;
  onUseAuto?: () => void;
  onUseDefault?: () => void;
  disabled?: boolean;
}

export function EffortSlider({
  levels,
  value,
  label,
  auto,
  defaultLevel,
  onChange,
  onUseAuto,
  onUseDefault,
  disabled,
}: EffortSliderProps) {
  const { t } = useI18n();
  const index = Math.max(0, levels.indexOf(value ?? ""));
  const last = Math.max(1, levels.length - 1);
  const percent = (index / last) * 100;

  return (
    <div className="effort-card">
      <div className="effort-top">
        <div className="effort-head">
          <span className="effort-label">{t("chat.reasoningLevel")}</span>
          <span className="effort-value" data-auto={auto || undefined}>{label}</span>
        </div>
        {onUseDefault && defaultLevel && (
          <button
            type="button"
            className="effort-btn"
            title={t("chat.defaultThinking")}
            aria-label={t("chat.defaultThinking")}
            onClick={onUseDefault}
          >
            <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
              <use href="#i-refresh" />
            </svg>
          </button>
        )}
      </div>

      <div className="effort-track">
        <div className="effort-rail" />
        <div className="effort-fill" style={{ width: `${percent}%` }} />
        {levels.map((level, i) => (
          <span
            key={level}
            className={`effort-stop${i <= index ? "" : " is-off"}`}
            style={{ left: `${(i / last) * 100}%` }}
          />
        ))}
        <div className="effort-thumb" style={{ left: `${percent}%` }} />
        <input
          type="range"
          className="effort-range"
          min={0}
          max={last}
          step={1}
          value={index}
          disabled={disabled}
          aria-label={t("chat.changeReasoningLabel")}
          onChange={(event) => {
            const next = levels[Number(event.currentTarget.value)];
            if (next && next !== value) onChange(next);
          }}
        />
      </div>

      {onUseAuto && (
        <div className="effort-legend">
          <button
            type="button"
            className={`effort-auto${auto ? " is-on" : ""}`}
            aria-pressed={auto}
            onClick={onUseAuto}
          >
            {t("chat.reasoningAuto")}
          </button>
        </div>
      )}
    </div>
  );
}
