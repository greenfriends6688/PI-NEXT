"use client";

import { useEffect, useMemo, useState } from "react";
import type { ToolEntry } from "@/lib/tool-presets";
import { getToolParameterFields as getSharedToolParameterFields } from "@/lib/tool-parameters";

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface Props {
  loading: boolean;
  tools: ToolEntry[] | null;
  translate: Translate;
}

interface ParameterField {
  name: string;
  type: string;
  description?: string;
  required: boolean;
  allowedValues?: string;
  defaultValue?: string;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * 面板展示层：把 lib/tool-parameters 的解析结果映射成现有的字符串字段。
 *
 * 递归 anyOf/oneOf、单 null 折叠成 `type?`、`enum<N>`、`const`、`Array<...>`、
 * `$ref`→any、`nullable` 等规则全部收敛在纯函数里；这里只负责根 schema 的
 * properties/required 形状归一化，以及 enum/default 面向 UI 的格式化。
 */
export function getToolParameterFields(parameters?: Record<string, unknown>): ParameterField[] {
  if (!parameters || !parameters.properties || typeof parameters.properties !== "object") return [];
  const normalized: Record<string, unknown> = {
    ...parameters,
    properties: parameters.properties as Record<string, unknown>,
    required: Array.isArray(parameters.required)
      ? parameters.required.filter((value): value is string => typeof value === "string")
      : [],
  };

  return getSharedToolParameterFields(normalized).map((field) => ({
    name: field.name,
    type: field.type,
    description: field.description,
    required: field.required,
    allowedValues: field.enumValues ? field.enumValues.map(formatValue).join(", ") : undefined,
    defaultValue: field.defaultValue === undefined ? undefined : formatValue(field.defaultValue),
  }));
}

/** 工具名 → 画板 22 列表行的 lucide 图标（内置工具给语义图，扩展给通用工具图）。 */
const TOOL_ICON_BY_NAME: Record<string, string> = {
  read: "file-text",
  write: "pencil-line",
  edit: "pencil-line",
  bash: "terminal",
  grep: "file-search",
  glob: "file-search",
  fetch: "globe",
  task: "bot",
  Agent: "bot",
  get_subagent_result: "bot",
  steer_subagent: "bot",
  todo_write: "list-checks",
  todo_read: "list-checks",
};

/** 未登记的工具走 `wrench`：`puzzle` 不在画板图标集（icons.js 只收 lucide 实名）里。 */
function toolIcon(name: string): string {
  return TOOL_ICON_BY_NAME[name] ?? "wrench";
}

/**
 * 画板 22 的列表行末尾有一枚 `.pw-desc` 短标签。真实描述是一整段，取第一句并截断，
 * 只当「一眼分类」用；完整描述仍在右侧详情里，所以这里丢了信息也不算丢信息。
 */
function shortLabel(description: string): string | undefined {
  const first = description.split(/[。．.\n]/)[0]?.trim();
  if (!first) return undefined;
  return first.length > 24 ? `${first.slice(0, 23)}…` : first;
}

function matchesQuery(tool: ToolEntry, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return tool.name.toLowerCase().includes(needle) || tool.description.toLowerCase().includes(needle);
}

export function ToolDefinitionsPanel({ loading, tools, translate }: Props) {
  const activeTools = useMemo(() => tools?.filter((tool) => tool.active) ?? null, [tools]);
  const inactiveTools = useMemo(() => tools?.filter((tool) => !tool.active) ?? null, [tools]);
  const [selectedToolName, setSelectedToolName] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setSelectedToolName((current) => (
      activeTools?.some((tool) => tool.name === current)
        ? current
        : activeTools?.[0]?.name ?? null
    ));
  }, [activeTools]);

  const needle = query.trim().toLowerCase();
  const shownActive = useMemo(
    () => activeTools?.filter((tool) => matchesQuery(tool, needle)) ?? null,
    [activeTools, needle],
  );
  const shownInactive = useMemo(
    () => inactiveTools?.filter((tool) => matchesQuery(tool, needle)) ?? null,
    [inactiveTools, needle],
  );

  const selectedTool = activeTools?.find((tool) => tool.name === selectedToolName)
    ?? activeTools?.[0]
    ?? null;
  const fields = selectedTool ? getToolParameterFields(selectedTool.parameters) : [];
  const selectedLabel = selectedTool ? shortLabel(selectedTool.description) : undefined;

  const row = (tool: ToolEntry, selectable: boolean) => {
    const selected = selectable && tool.name === selectedTool?.name;
    const label = shortLabel(tool.description);
    const body = (
      <>
        <span className="pw-ico"><i data-ico={toolIcon(tool.name)} data-size="14"></i></span>
        <span className="grow pw-mono" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "var(--text-meta)" }}>{tool.name}</span>
        {label ? (
          <span className="pw-desc" style={{ maxWidth: "45%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        ) : null}
      </>
    );
    if (!selectable) {
      // 画板 22 的未启用行是 `.pw-prow` + `opacity:.5`（不是禁用态 button，避免焦点陷阱）。
      return (
        <div key={tool.name} className="pw-prow" style={{ opacity: 0.5, width: "100%" }} title={tool.description || tool.name}>
          {body}
        </div>
      );
    }
    return (
      <button
        key={tool.name}
        type="button"
        className={`pw-prow${selected ? " is-on" : ""}`}
        style={{ width: "100%" }}
        aria-pressed={selected}
        onClick={() => setSelectedToolName(tool.name)}
        title={tool.description || tool.name}
      >
        {body}
      </button>
    );
  };

  return (
    // fork:design-system SW-14 —— 左列表 + 右详情 = 画板 22：
    // 左 pw-pop（pw-pop-search 头 + 已启用/未启用 pw-pop-title 分组 + pw-prow 行），
    // 右 pw-pop 详情（accent 图标 + 工具名 + 短标签徽章 + 已启用徽章 + pw-sec-title + 参数）。
    // 参数表维持两列（名字 + 类型/描述/允许值/默认）——⊘ DIVERGENCE 29 信息等价，不压四列。
    // 两列网格 clamp(112px, 26%, 220px)：窄屏自动收到 112px，不需要断点，因此没有媒体查询。
    <div
      className="tool-definitions-panel"
      style={{
        display: "grid",
        gridTemplateColumns: "clamp(112px, 26%, 220px) minmax(0, 1fr)",
        gap: "var(--s3)",
        height: "min(600px, 75dvh)",
        minHeight: 240,
        padding: "var(--s3)",
        overflow: "hidden",
        background: "var(--surface-canvas)",
      }}
    >
      <nav
        className="tool-definitions-sidebar pw-pop"
        aria-label={translate("tools.title")}
        style={{ display: "flex", flexDirection: "column", minHeight: 0, width: "auto", padding: 0, overflow: "hidden" }}
      >
        <div className="pw-pop-search" style={{ margin: "0 0 var(--s1)" }}>
          <span className="pw-ico"><i data-ico="search" data-size="14"></i></span>
          <input
            className="pw-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={translate("tools.searchPlaceholder")}
            aria-label={translate("tools.searchPlaceholder")}
            style={{ minWidth: 0, flex: 1, height: 24, border: 0, background: "transparent" }}
          />
        </div>
        <div className="tool-definitions-list" style={{ minHeight: 0, flex: 1, overflowY: "auto", padding: "0 var(--s1) var(--s1)" }}>
          {shownActive && shownActive.length > 0 ? (
            <>
              <div className="pw-pop-title">{translate("tools.enabledGroup", { count: shownActive.length })}</div>
              {shownActive.map((tool) => row(tool, true))}
              {shownInactive && shownInactive.length > 0 && (
                <>
                  <div className="pw-pop-title">{translate("tools.disabledGroup", { count: shownInactive.length })}</div>
                  {shownInactive.map((tool) => row(tool, false))}
                </>
              )}
            </>
          ) : activeTools && (shownActive?.length ?? 0) === 0 && needle ? (
            <div className="pw-prow"><span className="pw-desc">{translate("tools.noMatches")}</span></div>
          ) : activeTools ? (
            <div className="pw-prow"><span className="pw-desc">{translate("tools.noTools")}</span></div>
          ) : (
            <div className="pw-prow"><span className="pw-desc">{loading ? translate("tools.loading") : translate("tools.load")}</span></div>
          )}
        </div>
      </nav>

      <section
        className="tool-definition-detail pw-pop"
        aria-label={translate("tools.details")}
        style={{ minWidth: 0, minHeight: 0, width: "auto", padding: "var(--s3) var(--s4)", overflowY: "auto" }}
      >
        {selectedTool ? (
          <>
            <div className="pw-inline" style={{ marginBottom: "var(--s2)" }}>
              <span className="pw-ico" style={{ color: "var(--accent-text)" }}><i data-ico={toolIcon(selectedTool.name)} data-size="16"></i></span>
              <b className="pw-mono" style={{ fontWeight: 500, fontSize: "var(--text-title)", color: "var(--n-strong)", overflowWrap: "anywhere" }}>{selectedTool.name}</b>
              {selectedLabel ? <span className="pw-badge">{selectedLabel}</span> : null}
              <span className="grow" />
              <span className="pw-badge ok">{translate("tools.enabledBadge")}</span>
            </div>
            {selectedTool.description && (
              <p style={{ margin: "0 0 var(--s3)", color: "var(--n-muted)", fontSize: "var(--text-secondary)", lineHeight: 1.55, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
                {selectedTool.description}
              </p>
            )}

            <div className="pw-sec-title">
              <span>{translate("tools.parameters")}</span>
              <span className="grow" />
              <span className="pw-badge count">{translate("tools.parameterCount", { count: fields.length })}</span>
            </div>
            {fields.length > 0 ? (
              <table className="pw-table" style={{ fontSize: "var(--text-meta)" }}>
                <tbody>
                  {fields.map((field) => (
                    <tr key={field.name}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <span className="pw-mono">{field.name}</span>
                        {field.required && (
                          <span className="pw-badge bad" style={{ marginLeft: 6 }}>{translate("tools.required")}</span>
                        )}
                      </td>
                      <td style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                        <span className="pw-mono">{field.type}</span>
                        {field.description && <div style={{ color: "var(--n-muted)" }}>{field.description}</div>}
                        {field.allowedValues && (
                          <div style={{ color: "var(--n-placeholder)" }}>
                            {translate("tools.allowedValues")}: <span className="pw-mono">{field.allowedValues}</span>
                          </div>
                        )}
                        {field.defaultValue !== undefined && (
                          <div style={{ color: "var(--n-placeholder)" }}>
                            {translate("tools.defaultValue")}: <span className="pw-mono">{field.defaultValue}</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="pw-prow"><span className="pw-desc">{translate("tools.noParameters")}</span></div>
            )}

            {selectedTool.promptGuidelines && selectedTool.promptGuidelines.length > 0 && (
              <>
                <div className="pw-sec-title" style={{ marginTop: "var(--s3)" }}>{translate("tools.guidelines")}</div>
                <ul style={{ margin: 0, paddingLeft: 18, color: "var(--n-muted)", fontSize: "var(--text-secondary)", lineHeight: 1.55 }}>
                  {selectedTool.promptGuidelines.map((guideline, index) => (
                    <li key={`${selectedTool.name}:${index}`}>{guideline}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        ) : (
          <div className="pw-prow">
            <span className="pw-desc">
              {activeTools
                ? translate("tools.noTools")
                : loading
                  ? translate("tools.loading")
                  : translate("tools.load")}
            </span>
          </div>
        )}
      </section>
    </div>
  );
}
