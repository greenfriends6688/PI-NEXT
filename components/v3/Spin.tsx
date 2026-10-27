"use client";

import type { CSSProperties } from "react";

/**
 * droppy 的 WorkingIndicators，照 design/v3/assets/running.js 的两条相位公式：
 * - grid 3×3：相位 = 到底部中心的距离 ÷ 2.5，波从底部中心往上走
 * - mini 2×3：沿周界顺时针绕一圈，2.4 格
 * 每格是一个 <i>，动画延迟用负的 --lag 让波相位错开；三行 tint 由 CSS 的 --spin-1/2/3 给。
 */
const GRID_CELLS = (() => {
  const cells: { row: number; col: number; lag: number }[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const dx = col - 1;
      const dy = 2 - row;
      cells.push({ row, col, lag: Math.sqrt(dx * dx + dy * dy) / 2.5 });
    }
  }
  return cells;
})();

// [row, col] 沿 2×3 的周界顺时针
const RING: [number, number][] = [
  [0, 0],
  [0, 1],
  [1, 1],
  [2, 1],
  [2, 0],
  [1, 0],
];

const MINI_CELLS = RING.map(([row, col], index) => ({ row, col, lag: index / RING.length }));

export function Spin({
  variant = "grid",
  className = "",
  label,
}: {
  /** grid：3×3 主指示器；sm：状态行的 2.5；mini：侧栏 2×3 */
  variant?: "grid" | "sm" | "mini";
  className?: string;
  label?: string;
}) {
  const cells = variant === "mini" ? MINI_CELLS : GRID_CELLS;
  const sizeClass = variant === "mini" ? "spin--mini" : variant === "sm" ? "spin--sm" : "";
  return (
    <span
      className={["spin", sizeClass, className].filter(Boolean).join(" ")}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {cells.map(({ row, col, lag }) => (
        <i key={`${row}-${col}`} data-row={row} style={{ "--lag": lag } as CSSProperties} />
      ))}
    </span>
  );
}
