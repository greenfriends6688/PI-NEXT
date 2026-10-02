"use client";

import { useI18n } from "@/hooks/useI18n";
import type { SkillActivation } from "@/lib/skill-usage";

/**
 * Chips for the skills a turn actually used, rendered **next to**
 * `components/TurnWrittenFiles.tsx` — same wrap row, same `.pw-chip` primitive, no
 * panel of its own. One chip per skill; clicking opens the Skills settings section
 * with that slug selected.
 *
 * fork:proma-32-skill-usage（计划 PR-32 · F1，依据 Proma 的
 * `components/agent/TurnSkillUsageSummary.tsx` + `docs/plans/2026-08-11-skill-usage-chips.md`）
 *
 * - 数据来自 `lib/skill-usage.ts`：只有**配对成功**的 `read` 命中 `skills/<slug>/SKILL.md`
 *   才算数，`explicit` 再叠一层用户敲过的 `/skill:<name>`。这里不重算，只负责画。
 * - **流式中不渲染**：流式时每读到一份 SKILL.md 就多一枚 chip、失败一次就少一枚，
 *   逐帧增删的闪烁比没有这行信息更伤。回合结束后一次性出现。
 * - 只用画板已有类（`.pw-wrap` / `.pw-chip` / `.pw-ico`，图标走 `<i data-ico="sparkles">`），
 *   不新造 `.pw-*`。
 */
export function TurnSkillUsageSummary({
  skills,
  isStreaming,
  onOpenSkill,
}: {
  skills: SkillActivation[];
  isStreaming?: boolean;
  onOpenSkill?: (slug: string) => void;
}) {
  const { t } = useI18n();

  if (isStreaming || skills.length === 0) return null;

  return (
    <div className="pw-wrap" aria-label={t("chat.skillsUsed")} style={{ marginTop: "var(--s2)" }}>
      {skills.map((skill) => {
        const label = skill.name ?? skill.slug;
        return (
          <button
            key={skill.slug}
            type="button"
            className="pw-chip"
            // chip 上只给相对路径 `<slug>/SKILL.md`：绝对路径会进模型上下文，也泄露目录结构。
            title={skill.workspaceSkillPath}
            aria-label={t("chat.openSkillUsed", { name: label })}
            disabled={!onOpenSkill}
            onClick={() => onOpenSkill?.(skill.slug)}
          >
            <span className="pw-ico"><i data-ico="sparkles" data-size="12"></i></span>
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}