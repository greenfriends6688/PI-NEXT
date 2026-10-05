"use client";

import { useI18n } from "@/hooks/useI18n";
import type { SkillActivation } from "@/lib/skill-usage";
// fork:v5-wave-b —— 窄屏换成画板 M-03/M-08/M-10 的 `.m-tray` + `.m-tray-chip`
// （PWA 库里唯一的芯片原语；`m-chips` / `m-chipbtn` 定义了但没有画板在用），
// 图标一律裸 `<i data-ico>`（画板的芯片里没有图标包装层）。
import { usePwaSkin } from "@/components/pwa/skin";

/**
 * Chips for the skills a turn actually used, rendered **next to**
 * `components/TurnWrittenFiles.tsx` — 同一个竖排区块（`.fork-turn-summary`）里的
 * 两个平级块，各是「抬头行 + 一行 chips」，不另起面板。One chip per skill;
 * clicking opens the Skills settings section with that slug selected.
 *
 * fork:proma-32-skill-usage（计划 PR-32 · F1，依据 Proma 的
 * `components/agent/TurnSkillUsageSummary.tsx` + `docs/plans/2026-08-11-skill-usage-chips.md`）
 *
 * - 数据来自 `lib/skill-usage.ts`：只有**配对成功**的 `read` 命中 `skills/<slug>/SKILL.md`
 *   才算数，`explicit` 再叠一层用户敲过的 `/skill:<name>`。这里不重算，只负责画。
 * - **流式中不渲染**：流式时每读到一份 SKILL.md 就多一枚 chip、失败一次就少一枚，
 *   逐帧增删的闪烁比没有这行信息更伤。回合结束后一次性出现。
 * - fork:v5-landing —— 桌面芯片从 `.pw-wrap` / `.pw-chip` 换成画板 D-03e 帧 B 的
 *   `.d-chips` / `.d-chipbtn`：这两枚**本来就是动作芯片**（`d-chipbtn` 是一枚可点的
 *   药丸），而 `d-cite` 是文件芯片。同一行 chips 里混两套原语就是「同一个值两个
 *   来源」的老毛病。原先留着 `pw-*` 只因为源码守卫在逐字符匹配它，守卫已同步更新。
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
    // fork:v5-landing —— 画板 D-03e 帧 B：技能块与「改了哪些文件」一样是
    // 「一行抬头（sparkles + 标题） + 一行 `.d-chips`」，不是一个孤零零的芯片堆。
    // fork:v5-wave-b —— 窄屏换 PWA 形态的芯片（`.m-tray` + `.m-tray-chip`）。
    <div className={isPwa ? "m-tray" : undefined} style={isPwa ? undefined : { display: "flex", flexDirection: "column", gap: "var(--nx-sp-2)", minWidth: 0 }} aria-label={t("chat.skillsUsed")}>
      {!isPwa && (
        <div className="d-row">
          <i data-ico="sparkles" data-size="14" aria-hidden="true"></i>
          <span className="d-t-sm d-grow">{t("chat.skillsUsedHeader")}</span>
        </div>
      )}
      <div className={isPwa ? undefined : "d-chips"}>
        {skills.map((skill) => {
          const label = skill.name ?? skill.slug;
          return (
            <button
              key={skill.slug}
              type="button"
              className={isPwa ? "m-tray-chip" : "d-chipbtn"}
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
    </div>
  );
}