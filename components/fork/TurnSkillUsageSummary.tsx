"use client";

import { useI18n } from "@/hooks/useI18n";
import type { SkillActivation } from "@/lib/skill-usage";
// fork:v5-wave-b —— 窄屏换成画板 M-03/M-08/M-10 的 `.m-tray` + `.m-tray-chip`
// （PWA 库里唯一的芯片原语；`m-chips` / `m-chipbtn` 定义了但没有画板在用），
// 图标一律裸 `<i data-ico>`（画板的芯片里没有图标包装层）。
// 桌面的 `.pw-wrap` / `.pw-chip` 由本目录的 `TurnSkillUsageSummary.test.mjs`
// 当源码守卫逐字符匹配（守卫本身还停在 v1 断言），按「被测试当选择器的保留并
// 注释」处理 —— 收尾波更新该测试时一并换成 `.d-chips` / `.d-cite`。
import { usePwaSkin } from "@/components/pwa/skin";

/**
 * Chips for the skills a turn actually used, rendered **next to**
 * `components/TurnWrittenFiles.tsx` — same wrap row, same chip primitive, no
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
 * - 只用画板已有类，图标走 `<i data-ico="sparkles">`，不新造类。
 *   fork:v5-wave-b —— 手机形态用 `.m-tray` / `.m-tray-chip`（桌面是 `.d-chips` 家族）。
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
  const isPwa = usePwaSkin();

  if (isStreaming || skills.length === 0) return null;

  return (
    // fork:v5-wave-b —— 窄屏换 PWA 形态的芯片（`.m-tray` + `.m-tray-chip`）。
    // 桌面的 `.pw-wrap` / `.pw-chip` 由 `TurnSkillUsageSummary.test.mjs` 逐字符
    // 匹配（该守卫还停在 v1 断言），按「被测试当选择器的保留并注释」处理。
    <div className={isPwa ? "m-tray" : "pw-wrap"} aria-label={t("chat.skillsUsed")} style={{ marginTop: "var(--s2)" }}>
      {skills.map((skill) => {
        const label = skill.name ?? skill.slug;
        return (
          <button
            key={skill.slug}
            type="button"
            className={isPwa ? "m-tray-chip" : "pw-chip"}
            // chip 上只给相对路径 `<slug>/SKILL.md`：绝对路径会进模型上下文，也泄露目录结构。
            title={skill.workspaceSkillPath}
            aria-label={t("chat.openSkillUsed", { name: label })}
            disabled={!onOpenSkill}
            onClick={() => onOpenSkill?.(skill.slug)}
          >
            <i data-ico="sparkles" data-size="12"></i>
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}