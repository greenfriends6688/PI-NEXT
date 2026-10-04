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
  // fork:agent-mail —— 与上面三个同一族（画板 22 也给 bot）。
  agent_mail: "bot",
  todo_write: "list-checks",
  todo_read: "list-checks",
};

/** 未登记的工具走 `wrench`：`puzzle` 不在画板图标集（icons.js 只收 lucide 实名）里。 */
function toolIcon(name: string): string {
  return TOOL_ICON_BY_NAME[name] ?? "wrench";
}

/**
 * 画板 22 的列表行末尾有一枚短标签。真实描述是一整段，取第一句并截断，
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

  /* fork:v5-landing —— 行原子 = 画板 D-02b 帧 A ② 的 `.d-menu-row`：选中行把图标位
     换成对勾（画板「选中行」八态），名字 `d-grow d-mono`、短标签 `d-t-xs d-t-faint`。
     未启用行是弱化的 `.d-menu-row`（`d-t-faint`），不做 disabled button（避免焦点陷阱）。
     名字 `d-grow` 可收缩、短标签上限 96px 这两条是产品真值（fix:tools-panel-width），
     画板没有，故以内联宽度保留。 */
  const row = (tool: ToolEntry, selectable: boolean) => {
    const selected = selectable && tool.name === selectedTool?.name;
    const label = shortLabel(tool.description);
    const trailing = label ? (
      <span
        className="d-t-xs d-t-faint"
        style={{ flex: "0 1 auto", maxWidth: 96, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {label}
      </span>
    ) : null;
    if (!selectable) {
      return (
        <div key={tool.name} className="d-menu-row" style={{ cursor: "default" }} title={tool.description || tool.name}>
          <i data-ico={toolIcon(tool.name)} data-size="14" aria-hidden="true" className="d-t-faint"></i>
          <span className="d-grow d-mono d-t-faint">{tool.name}</span>
          {trailing}
        </div>
      );
    }
    return (
      <button
        key={tool.name}
        type="button"
        className="d-menu-row"
        aria-pressed={selected}
        onClick={() => setSelectedToolName(tool.name)}
        title={tool.description || tool.name}
      >
        {selected
          ? <i data-ico="check" data-size="14" aria-hidden="true"></i>
          : <i data-ico={toolIcon(tool.name)} data-size="14" aria-hidden="true"></i>}
        <span className="d-grow d-mono">{tool.name}</span>
        {trailing}
      </button>
    );
  };

  return (
    // fork:design-system SW-14 —— 左列表 + 右详情 = 画板 22：
    // 左 d-searchfield 头 + 已启用/未启用 d-pop-title 分组 + d-menu-row 行，
    // 右详情（accent 图标 + 工具名 + 短标签徽章 + 已启用徽章 + 参数 d-table + 使用指南）。
    // 参数表维持两列（名字 + 类型/描述/允许值/默认）——⊘ DIVERGENCE 29 信息等价，不压四列。
    // 两列网格 clamp(240px, 30%, 300px)：左列表按画板 22 的 300px 量级给（工具名
    // 是 `get_subagent_result` 这种长度，112px 装不下就会全被截成一个字母），
    // 右详情自适应。整块面板的宽度由 AppShell 的 TOP_BAR_WIDE_PANEL_WIDTH 给。
    <div
      className="tool-definitions-panel"
      style={{
        display: "grid",
        gridTemplateColumns: "clamp(240px, 30%, 300px) minmax(0, 1fr)",
        gap: "var(--nx-sp-3)",
        height: "min(600px, 75dvh)",
        minHeight: 240,
        overflow: "hidden",
      }}
    >
      <nav
        className="tool-definitions-sidebar d-col"
        aria-label={translate("tools.title")}
        style={{ minHeight: 0 }}
      >
        <div className="d-searchfield" style={{ margin: "0 0 var(--nx-sp-1)" }}>
          <i data-ico="search" data-size="13" aria-hidden="true"></i>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={translate("tools.searchPlaceholder")}
            aria-label={translate("tools.searchPlaceholder")}
          />
        </div>
        <div className="tool-definitions-list d-scroll" style={{ minHeight: 0, flex: 1, padding: "0 var(--nx-sp-1) var(--nx-sp-1)" }}>
          {shownActive && shownActive.length > 0 ? (
            <>
              <div className="d-pop-title">{translate("tools.enabledGroup", { count: shownActive.length })}</div>
              {shownActive.map((tool) => row(tool, true))}
              {shownInactive && shownInactive.length > 0 && (
                <>
                  <div className="d-pop-title">{translate("tools.disabledGroup", { count: shownInactive.length })}</div>
                  {shownInactive.map((tool) => row(tool, false))}
                </>
              )}
            </>
          ) : activeTools && (shownActive?.length ?? 0) === 0 && needle ? (
            <div className="d-menu-row" style={{ cursor: "default" }}><span className="d-t-faint">{translate("tools.noMatches")}</span></div>
          ) : activeTools ? (
            <div className="d-menu-row" style={{ cursor: "default" }}><span className="d-t-faint">{translate("tools.noTools")}</span></div>
          ) : (
            <div className="d-menu-row" style={{ cursor: "default" }}><span className="d-t-faint">{loading ? translate("tools.loading") : translate("tools.load")}</span></div>
          )}
        </div>
      </nav>

      <section
        className="tool-definition-detail d-col"
        aria-label={translate("tools.details")}
        style={{ minWidth: 0, minHeight: 0, overflowY: "auto", gap: "var(--nx-sp-2)" }}
      >
        {selectedTool ? (
          <>
            <div className="d-row">
              <i data-ico={toolIcon(selectedTool.name)} data-size="16" aria-hidden="true" style={{ color: "var(--nx-accent)" }}></i>
              <span className="d-t-b d-mono" style={{ overflowWrap: "anywhere" }}>{selectedTool.name}</span>
              {selectedLabel ? <span className="d-badge mute">{selectedLabel}</span> : null}
              <span className="d-grow" />
              <span className="d-badge ok">{translate("tools.enabledBadge")}</span>
            </div>
            {selectedTool.description && (
              <p className="d-t-cap d-t-dim" style={{ margin: 0, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
                {selectedTool.description}
              </p>
            )}

            <div className="d-row">
              <span className="d-t-xs d-t-faint">{translate("tools.parameters")}</span>
              <span className="d-badge mute">{translate("tools.parameterCount", { count: fields.length })}</span>
            </div>
            {fields.length > 0 ? (
              <table className="d-table">
                <tbody>
                  {fields.map((field) => (
                    <tr key={field.name}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <span className="d-mono">{field.name}</span>
                        {field.required && (
                          <span className="d-badge bad" style={{ marginLeft: "var(--nx-sp-2)" }}>{translate("tools.required")}</span>
                        )}
                      </td>
                      <td style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                        <span className="d-mono">{field.type}</span>
                        {field.description && <div className="d-t-faint">{field.description}</div>}
                        {field.allowedValues && (
                          <div className="d-t-faint">
                            {translate("tools.allowedValues")}: <span className="d-mono">{field.allowedValues}</span>
                          </div>
                        )}
                        {field.defaultValue !== undefined && (
                          <div className="d-t-faint">
                            {translate("tools.defaultValue")}: <span className="d-mono">{field.defaultValue}</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="d-menu-row" style={{ cursor: "default" }}><span className="d-t-faint">{translate("tools.noParameters")}</span></div>
            )}

            {selectedTool.promptGuidelines && selectedTool.promptGuidelines.length > 0 && (
              <>
                <div className="d-t-xs d-t-faint" style={{ marginTop: "var(--nx-sp-2)" }}>{translate("tools.guidelines")}</div>
                <ul className="d-t-cap d-t-dim" style={{ margin: 0, paddingLeft: 18 }}>
                  {selectedTool.promptGuidelines.map((guideline, index) => (
                    <li key={`${selectedTool.name}:${index}`}>{guideline}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        ) : (
          <div className="d-menu-row" style={{ cursor: "default" }}>
            <span className="d-t-faint">
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
