/**
 * fork:codemode-settings-ui —— 设置 › MCP 里的「代码模式」区块。
 *
 * 上游 0.10 在 MCP 页侧栏第一行放了「Code mode」，点进去是三样设置。本仓的 MCP 页是
 * `PluginsConfig` 的 `only="mcp"` 形态（侧栏是 server 列表，没有「点开一个非 server 的
 * 详情」的位置），所以把同一份设置做成详情区顶部的一个可折叠块 —— 形态不同、内容与
 * 写盘口径完全走上游那套（`PUT /api/tools/settings`，同一个 pi 文件锁）。
 *
 * 三项：
 *   · **自动 / 始终开启** —— `always` 给全局 `defaultTools` 加 `+codemode`（会话一开就带着），
 *     `automatic` 什么都不写（默认路径：MCP 的工具走 codemode 曝光时由 mcp 扩展按需激活）；
 *   · **mode：on / only** —— pi 的 `codemode.mode`。`only` 把 active 的 `direct` 工具收进
 *     codemode 描述、只由脚本调用（工具表最干净）；
 *   · **工具清单预算** —— `codemode.inlineBudget`，codemode 描述允许花在工具声明上的
 *     估算 token（pi 默认 3000）。
 *
 * 项目级 `.pi/settings.json` 可覆盖前两项：这里显示「该项目用的是哪个值」，但**只读**
 * （项目设置仍由 CLI 管，与上游同一条边界）。
 */

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ToolSettingsResponse } from "@/lib/api-types";
import { ConfigField } from "../SettingsUi";

interface Props {
  cwd: string | null;
}

const INLINE_BUDGET_MAX = 1_000_000;

export function McpCodemodeSettings({ cwd }: Props) {
  const { t } = useI18n();
  const [data, setData] = useState<ToolSettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [budgetText, setBudgetText] = useState("");

  const load = useCallback(async () => {
    try {
      const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
      const response = await fetch(`/api/tools/settings${query}`, { cache: "no-store" });
      const payload = (await response.json()) as ToolSettingsResponse & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? `HTTP ${response.status}`);
        return;
      }
      setData(payload);
      setBudgetText(payload.codemodeInlineBudget.value === undefined ? "" : String(payload.codemodeInlineBudget.value));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [cwd]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async (patch: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/tools/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // 请求体必须**恰好**带一个键（上游同款：一次只改一项，省掉并发写的合并问题）。
        body: JSON.stringify(patch),
      });
      const payload = (await response.json()) as ToolSettingsResponse & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? `HTTP ${response.status}`);
        return;
      }
      setData(payload);
      setBudgetText(payload.codemodeInlineBudget.value === undefined ? "" : String(payload.codemodeInlineBudget.value));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, []);

  const commitBudget = useCallback(() => {
    const trimmed = budgetText.trim();
    if (trimmed === "") {
      void save({ codemodeInlineBudget: null });
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value < 0 || value > INLINE_BUDGET_MAX) return;
    void save({ codemodeInlineBudget: value });
  }, [budgetText, save]);

  if (!data) {
    return error ? (
      <div className="pw-alert bad">
        <span className="pw-ico"><i data-ico="triangle-alert" data-size="14"></i></span>
        <span className="pw-grow">{error}</span>
      </div>
    ) : null;
  }

  return (
    <div>
      <ConfigField label={t("mcp.codemode.title")}>
        <select
          className="pw-select"
          value={data.codemode}
          disabled={saving}
          onChange={(event) => void save({ codemode: event.target.value })}
          title={t("mcp.codemode.automaticDescription")}
        >
          <option value="automatic">{t("mcp.codemode.automatic")}</option>
          <option value="always">{t("mcp.codemode.always")}</option>
        </select>
      </ConfigField>

      <ConfigField label={t("mcp.codemode.mode")}>
        <select
          className="pw-select"
          value={data.codemodeMode.value}
          disabled={saving}
          onChange={(event) => void save({ codemodeMode: event.target.value })}
          title={data.codemodeMode.invalid
            ? t("mcp.codemode.toolMode.invalid", { value: data.codemodeMode.invalid })
            : t("mcp.codemode.toolMode.onDescription")}
        >
          <option value="on">{t("mcp.codemode.toolMode.on")}</option>
          <option value="only">{t("mcp.codemode.toolMode.only")}</option>
        </select>
      </ConfigField>

      <ConfigField label={t("mcp.codemode.inlineBudget")}>
        <input
          className="pw-input"
          inputMode="numeric"
          value={budgetText}
          placeholder={t("mcp.codemode.inlineBudget.unit")}
          disabled={saving}
          title={data.codemodeInlineBudget.invalid
            ? t("mcp.codemode.inlineBudget.invalid", { value: data.codemodeInlineBudget.invalid })
            : t("mcp.codemode.inlineBudget.description")}
          onChange={(event) => setBudgetText(event.target.value)}
          onBlur={commitBudget}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); commitBudget(); }
          }}
          style={{ width: "calc(var(--s6) * 4)" }}
        />
      </ConfigField>

      {error && (
        <div className="pw-alert bad">
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="14"></i></span>
          <span className="pw-grow">{error}</span>
        </div>
      )}
    </div>
  );
}