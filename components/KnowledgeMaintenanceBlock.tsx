"use client";

/**
 * fork:proma-51-knowledge —— 项目知识维护授权开关。
 *
 * `knowledge_write` 默认只读（见 `lib/knowledge-extension.ts`）。这个块是用户授权的
 * 唯一入口：打开后写 `~/.pi/agent/knowledge-maintenance.json`，扩展在每次调用时
 * 重新读取，所以开关即时生效、不需要重载会话。
 *
 * DOM 复用画板 40 帧 1 / 62 帧 C 右栏的 `.pw-block` + 一行 `.pw-field` + 开关
 * （与「重试策略」块同款，判据⑦）。项目路径写在说明里，避免为一个纯开关新造控件。
 */
import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { PwBlock, PwField, PwSwitch } from "./SettingsUi";

export function KnowledgeMaintenanceBlock({ cwd }: { cwd: string | null }) {
  const { t } = useI18n();
  const [approved, setApproved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cwd) {
      setLoading(false);
      setApproved(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetch(`/api/knowledge-maintenance?cwd=${encodeURIComponent(cwd)}`)
      .then(async (response) => {
        const data = await response.json() as { approved?: boolean; error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (!cancelled) setApproved(data.approved === true);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [cwd]);

  const save = async (next: boolean): Promise<void> => {
    if (!cwd) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/knowledge-maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, approved: next }),
      });
      const data = await response.json() as { approved?: boolean; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setApproved(data.approved === true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PwBlock icon="brain" title={t("settings.knowledgeBlock")}>
      <PwField
        label={t("settings.knowledgeApprove")}
        hint={cwd ? t("settings.knowledgeApproveHint") : t("settings.projectRequired")}
        control={
          <PwSwitch
            checked={approved}
            disabled={!cwd || loading || error !== null}
            loading={saving}
            label={t("settings.knowledgeApprove")}
            onChange={(next) => void save(next)}
          />
        }
      />
      {error ? (
        <div role="alert" className="pw-alert">
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="14" aria-hidden="true" /></span>
          <span className="pw-grow">{error}</span>
        </div>
      ) : null}
    </PwBlock>
  );
}
