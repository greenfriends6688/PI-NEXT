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
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { PwaBanner, PwaSetRow } from "@/components/pwa/PwaPage";
import type { ToolSettingsResponse } from "@/lib/api-types";

interface Props {
  cwd: string | null;
}

const INLINE_BUDGET_MAX = 1_000_000;

export function McpCodemodeSettings({ cwd }: Props) {
  const { t } = useI18n();
  const mobile = useIsMobile();
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

  // fork:v5-landing Wave B · M-09 帧 B 表格行的同构：三项各一行 `.m-setrow`
  // （名字 + 说明 + 右侧控件），开关类用 `.m-pickbar` / `.m-picktag` 互斥。
  // 三项的写盘口径（一次只改一个键）与桌面完全相同。
  if (mobile && data) {
    return (
      <>
        <div className="m-cardgroup">
          <PwaSetRow label={t("mcp.codemode.title")} sub={t("mcp.codemode.automaticDescription")} />
          <div className="m-pickbar">
            <button
              type="button"
              className={`m-picktag${data.codemode === "automatic" ? " is-on" : ""}`}
              disabled={saving}
              onClick={() => void save({ codemode: "automatic" })}
            >
              {t("mcp.codemode.automatic")}
            </button>
            <button
              type="button"
              className={`m-picktag${data.codemode === "always" ? " is-on" : ""}`}
              disabled={saving}
              onClick={() => void save({ codemode: "always" })}
            >
              {t("mcp.codemode.always")}
            </button>
          </div>

          <PwaSetRow label={t("mcp.codemode.mode")} sub={t("mcp.codemode.toolMode.onDescription")} />
          <div className="m-pickbar">
            <button
              type="button"
              className={`m-picktag${data.codemodeMode.value === "on" ? " is-on" : ""}`}
              disabled={saving}
              onClick={() => void save({ codemodeMode: "on" })}
            >
              {t("mcp.codemode.toolMode.on")}
            </button>
            <button
              type="button"
              className={`m-picktag${data.codemodeMode.value === "only" ? " is-on" : ""}`}
              disabled={saving}
              onClick={() => void save({ codemodeMode: "only" })}
            >
              {t("mcp.codemode.toolMode.only")}
            </button>
          </div>

          <PwaSetRow
            label={t("mcp.codemode.inlineBudget")}
            sub={data.codemodeInlineBudget.invalid
              ? t("mcp.codemode.inlineBudget.invalid", { value: data.codemodeInlineBudget.invalid })
              : t("mcp.codemode.inlineBudget.description")}
          />
          <div className="m-doc-body">
            <input
              className="m-input"
              style={{ width: "100%" }}
              inputMode="numeric"
              value={budgetText}
              placeholder={t("mcp.codemode.inlineBudget.unit")}
              disabled={saving}
              onChange={(event) => setBudgetText(event.target.value)}
              onBlur={commitBudget}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); commitBudget(); }
              }}
            />
          </div>
        </div>
        {error && <PwaBanner icon="triangle-alert" tone="err" role="alert">{error}</PwaBanner>}
      </>
    );
  }

  // fork:v5-landing D-15 帧 B「基础配置」—— 标签在上、控件在下的 `.d-field` 组。
  // 画板没有单独的 codemode 设置帧，这三项与服务器表单同属「设置里的一段表单」。
  if (!data) return null;
  return (
    <div className="d-col" style={{ gap: "var(--nx-sp-3)" }}>
      <div className="d-field">
        <span className="d-field-t">{t("mcp.codemode.title")}</span>
        <select
          className="d-select"
          value={data.codemode}
          disabled={saving}
          onChange={(event) => void save({ codemode: event.target.value })}
          title={t("mcp.codemode.automaticDescription")}
        >
          <option value="automatic">{t("mcp.codemode.automatic")}</option>
          <option value="always">{t("mcp.codemode.always")}</option>
        </select>
      </div>

      <div className="d-field">
        <span className="d-field-t">{t("mcp.codemode.mode")}</span>
        <select
          className="d-select"
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
      </div>

      <div className="d-field">
        <span className="d-field-t">{t("mcp.codemode.inlineBudget")}</span>
        <input
          className="d-input"
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
          style={{ width: "calc(var(--nx-sp-6) * 5)" }}
        />
      </div>

      {error && (
        <div className="d-banner err">
          <i data-ico="triangle-alert" data-size="14" aria-hidden="true" />
          <span className="d-grow">{error}</span>
        </div>
      )}
    </div>
  );
}
