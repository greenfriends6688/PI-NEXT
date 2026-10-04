export type ThinkingVariant = "wave" | "spin" | "stars" | "comet";

/**
 * fork:v5-skin D-27 帧 C —— 思考指示器四变体（d-think-dots wave/spin、
 * d-think-stars、d-think-comet），图案与类名逐字来自画板；静止/收起态回落
 * 到画板 D-03d 的 `<i data-ico="brain">`（思考块摘要图标）。
 *
 * 产品现有调用只给 `active`（MessageView 的展开态）+ 可选 `variant`，
 * 默认 wave：与画板「正在推理」那一枚一致。`size` 只作用于静态 brain 图标，
 * 点阵尺寸由 .d-think-dots 的令牌给定（4px），不在这里另写。
 */
export function ThinkingIcon({
  active,
  size = 14,
  variant = "wave",
}: {
  active: boolean;
  size?: number;
  variant?: ThinkingVariant;
}) {
  if (!active) {
    return <i data-ico="brain" data-size={size} aria-hidden="true"></i>;
  }

  if (variant === "stars") {
    return (
      <span className="d-think-stars" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <svg key={i} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2l1.6 5.6L19 9.2l-5.4 1.6L12 16.4l-1.6-5.6L5 9.2l5.4-1.6z" />
          </svg>
        ))}
      </span>
    );
  }

  if (variant === "comet") {
    return (
      <svg className="d-think-comet" viewBox="0 0 60 26" fill="none" aria-hidden="true">
        <path
          pathLength="100"
          d="M5 13 C5 3 25 3 30 13 C35 23 55 23 55 13 C55 3 35 3 30 13 C25 23 5 23 5 13 Z"
          stroke="var(--nx-accent)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <span className={`d-think-dots ${variant === "spin" ? "spin" : "wave"}`} aria-hidden="true">
      <i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>
    </span>
  );
}
