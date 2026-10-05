"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  codemodeTotalCost,
  formatCodemodeCost,
  formatCodemodeDuration,
  type CodemodeCallStatus,
  type CodemodeCallView,
} from "@/lib/codemode-view";

// fork:v5-landing —— 画板 D-03d 帧 D 的 codemode 卡：
//   `.d-tool-body` › `.d-mono.d-t-xs`（脚本）› `.d-col`（每次调用一行）›
//   `.d-row.d-t-xs.d-t-faint`（更早的调用 + 模型花费）。
// 之前这个组件**一个 `d-*` 类都没有**：整块内联几何 + 旧令牌（`--bg-subtle`
// / `--danger-soft` / `--s2`）+ 文字字形 `…✓✗⊘` 当状态图标。文字字形在
// 判据里算手绘，与「图标一律 lucide + data-ico」冲突；旧令牌不在
// `--nx-*` 集合里，换主题会掉色。逐字抄板面即可。
//
// 「脚本调过的工具是这张卡里的**行**，不是各自的卡」——它们从来没有作为
// 独立工具调用回到模型面前（同一个 pi TUI 形态）。

/** Calls shown before the rest are folded behind a button; the newest stay visible. */
export const CODEMODE_VISIBLE_CALLS = 20;

/** 状态图标：画板帧 D 的四枚 lucide（loader-circle / check / circle-x / circle-slash）。 */
const STATUS_ICON: Record<CodemodeCallStatus, string> = {
  running: "loader-circle",
  ok: "check",
  error: "circle-x",
  cancelled: "circle-slash",
};

function CallRow({ call }: { call: CodemodeCallView }) {
  const { t } = useI18n();
  const label = t(`codemode.status.${call.status}`);
  const duration = formatCodemodeDuration(call.durationMs);
  return (
    /* fork:v5-landing —— 一次调用 = 一行 `.d-row.d-mono.d-t-xs`：
       固定宽度的图标槽（`--nx-sp-3`）· 工具名（`d-t-b`）· `d-grow` 参数 ·
       失败原文走 `d-err` · 末尾等宽秒数。 */
    <div className="d-row d-mono d-t-xs">
      <span style={{ width: "var(--nx-sp-3)", flexShrink: 0 }}>
        <i data-ico={STATUS_ICON[call.status]} data-size="11" role="img" aria-label={label} title={label}></i>
      </span>
      <span className="d-t-b" style={{ flexShrink: 0 }}>{call.name}</span>
      <span className="d-grow d-t-faint">{call.error ?? call.args ?? "—"}</span>
      {call.cost !== undefined && <span className="d-t-faint" style={{ flexShrink: 0 }}>{formatCodemodeCost(call.cost)}</span>}
      <span className="d-t-faint" style={{ flexShrink: 0 }}>
        {call.status === "cancelled" ? label : (duration || "—")}
      </span>
    </div>
  );
}

export function CodemodeCallList({ calls, omitted }: {
  calls: readonly CodemodeCallView[];
  /** Earlier calls a progress snapshot did not include. */
  omitted: number;
}) {
  const { t } = useI18n();
  const [showAll, setShowAll] = useState(false);
  if (calls.length === 0 && omitted === 0) return null;
  const hidden = showAll ? 0 : Math.max(0, calls.length - CODEMODE_VISIBLE_CALLS);
  const shown = hidden > 0 ? calls.slice(hidden) : calls;
  // Folded rows still count: the total covers every call the result lists.
  const totalCost = codemodeTotalCost(calls);
  return (
    /* fork:v5-landing —— 板面这一段没有标题行、没有独立边框底：它就长在
       脚本下面（同一个 `.d-tool-body` 内），收尾是**一行**「更早的调用 ·
       模型花费」，中间一个 `d-grow` 把两边推开。 */
    <div className="d-col" style={{ gap: "var(--nx-sp-1)", marginTop: "var(--nx-sp-3)" }}>
      {hidden > 0 && (
        <button type="button" className="d-btn sm ghost" onClick={() => setShowAll(true)} style={{ alignSelf: "flex-start" }}>
          {t("codemode.showEarlierCalls", { count: hidden })}
        </button>
      )}
      {shown.map((call, index) => (
        <CallRow key={call.id || `${hidden + index}`} call={call} />
      ))}
      {/* 板面收尾只有这一行：左边「更早的 N 次调用未显示」，右边等宽花费。 */}
      <div className="d-row d-t-xs d-t-faint" style={{ marginTop: "var(--nx-sp-2)" }}>
        <span>{omitted > 0 ? t("codemode.omittedCalls", { count: omitted }) : ""}</span>
        <span className="d-grow" />
        <span className="d-mono">{totalCost !== null ? t("codemode.modelCost", { cost: formatCodemodeCost(totalCost) }) : ""}</span>
      </div>
    </div>
  );
}