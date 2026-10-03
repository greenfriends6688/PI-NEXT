/**
 * fork:mcp-paste —— 「粘贴添加 MCP 服务器」面板。
 *
 * 一个粘贴框吃下四种东西（上游 `lib/mcp-import-*` 的解析能力，78 条上游测试已经替它背书）：
 *   · 安装命令：`npx -y @modelcontextprotocol/server-filesystem .`
 *   · 各家 CLI 的 `mcp add`：`pi` / `claude` / `codex` / `gemini`
 *   · JSON / JSONC 配置（Claude Desktop、Cursor、VS Code、Zed、opencode、MCP Registry…）
 *   · 安装链接：`cursor://…`、VS Code / Visual Studio / GitHub Copilot 的 web redirect
 *
 * **为什么不直接搬上游的 `McpAddServer.tsx`**：它依赖 6 个本仓 `SettingsUi` 没有的展示
 * 基件（`ConfigAddSourcePanel` / `ConfigAddSourceCatalog` / `ConfigDetailGrid` /
 * `ConfigSaveTarget`…）以及它那套 MCP 页数据层。搬过来等于把它的设计系统一并搬进来。
 * 解析、预览、拒绝原因、字段取值这些**真正有难度的东西**已经在 `lib/mcp-import-*` 与
 * `components/mcp-add-helpers.ts` 里（上游原样 + 测试），这里只做本仓设计系统的呈现。
 *
 * 提交时浏览器**只发粘贴原文**（外逐字段取值），服务端用同一个解析器再解析一遍
 * （`app/api/mcp` 的 `action:"paste"` → `lib/mcp-add.ts` 的 `prepareMcpAdd`）：浏览器
 * 拼不出一个 def 来绕过预检。
 */

import { useCallback, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { parseMcpImport, type McpImportServer } from "@/lib/mcp-import";
import {
  EMPTY_MCP_ADD_DRAFT,
  MCP_ADD_EXAMPLES,
  mcpAddFieldValues,
  mcpAddPreview,
  mcpAddProjectMode,
  mcpAddSecretPaths,
  mcpImportNoteSeverity,
  mcpImportProblemKey,
  mcpSuggestedVariableName,
  MCP_IMPORT_SOURCE_KEYS,
  type McpAddDraft,
} from "../mcp-add-helpers";
import { ConfigField, ConfigSwitch } from "../SettingsUi";
import type { McpResponse, McpScope } from "@/lib/api-types";

interface Props {
  cwd: string;
  scope: McpScope;
  data: McpResponse | null;
  busy: boolean;
  actionError: string | null;
  onScopeChange: (scope: McpScope) => void;
  onSubmit: (draft: McpAddDraft & { scope: McpScope }) => void;
  onCancel: () => void;
}

export function McpPastePanel({
  cwd,
  scope,
  data,
  busy,
  actionError,
  onScopeChange,
  onSubmit,
  onCancel,
}: Props) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<McpAddDraft>(EMPTY_MCP_ADD_DRAFT);
  const [showExamples, setShowExamples] = useState(true);

  const parsed = useMemo(
    () => (draft.text.trim() ? parseMcpImport(draft.text, { rawPi: draft.rawPi }) : null),
    [draft.text, draft.rawPi],
  );
  const server: McpImportServer | undefined =
    parsed && "servers" in parsed && parsed.ok ? parsed.servers[draft.server] ?? parsed.servers[0] : undefined;

  const values = useMemo(() => (server ? mcpAddFieldValues(server, { values: draft.values, references: draft.references }) : {}), [server, draft]);
  const preview = useMemo(
    () => (server ? mcpAddPreview(server, values) : null),
    [server, values],
  );
  const secretPaths = useMemo(
    () => (server ? mcpAddSecretPaths(server, values, draft.secretReferences) : []),
    [server, draft.values, draft.secretReferences],
  );
  const projectMode = useMemo(() => mcpAddProjectMode(data ?? ({} as McpResponse), cwd), [data, cwd]);

  const update = useCallback((patch: Partial<McpAddDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const submitBlock = (() => {
    if (!draft.text.trim()) return t("mcp.add.pasteEmpty");
    if (!server) return t("mcp.add.pasteUnreadable");
    if (scope === "project" && projectMode.kind === "blocked") return t("mcp.add.projectBlocked");
    if (secretPaths.length > 0) return t("mcp.add.secretGlobalOnly");
    return null;
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--s3)", minWidth: 0 }}>
      <ConfigField label={t("mcp.add.pasteLabel")}>
        <textarea
          className="pw-input"
          rows={5}
          spellCheck={false}
          value={draft.text}
          placeholder={t("mcp.add.pastePlaceholder")}
          onChange={(event) => {
            update({ text: event.target.value });
            setShowExamples(false);
          }}
          onPaste={() => setShowExamples(false)}
          style={{ minHeight: "calc(var(--s6) * 3)", resize: "vertical", fontFamily: "var(--font-mono)", fontSize: "var(--text-meta)" }}
        />
      </ConfigField>

      {/* 上游同款：空框时列出每种格式一个示例，点一下就填进来。 */}
      {showExamples && !draft.text.trim() && (
        <div className="pw-hint">
          <div style={{ marginBottom: "var(--s2)" }}>{t("mcp.add.pasteExamples")}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s1)", marginBottom: "var(--s1)" }}>
            {MCP_ADD_EXAMPLES.map((example) => (
              <button
                key={`${example.source}-${example.text}`}
                type="button"
                className="pw-btn sm"
                onClick={() => { update({ text: example.text }); setShowExamples(false); }}
              >
                {t(MCP_IMPORT_SOURCE_KEYS[example.source])}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 一段粘贴里读出多个 server 时让用户挑。 */}
      {parsed && "servers" in parsed && parsed.ok && parsed.servers.length > 1 && (
        <ConfigField label={t("mcp.add.serverCount", { count: parsed.servers.length })}>
          <select
            className="pw-select"
            value={draft.server}
            onChange={(event) => update({ server: Number(event.target.value) })}
          >
            {parsed.servers.map((entry, index) => (
              <option key={`${entry.name}-${index}`} value={index}>{entry.name}</option>
            ))}
          </select>
        </ConfigField>
      )}

      {parsed && !parsed.ok && (
        <div className="pw-alert warn">
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="14"></i></span>
          <span className="pw-grow">{t("mcp.add.pasteUnreadable")}</span>
        </div>
      )}

      {parsed && "notes" in parsed && parsed.notes.length > 0 && (
        <div className="pw-alert info">
          <span className="pw-ico"><i data-ico="info" data-size="14"></i></span>
          <span className="pw-grow">
            {parsed.notes.map((note) => (
              <span key={note.code} style={{ display: "block" }}>
                {mcpImportNoteSeverity(note) === "error"
                  ? t(mcpImportProblemKey(note as unknown as Record<string, string | number>))
                  : note.code}
              </span>
            ))}
          </span>
        </div>
      )}

      {preview && (
        <>
          <ConfigField label={t("mcp.fieldType")}>
            <span className="pw-mono">{preview.transport === "http" ? "http" : "stdio"}</span>
          </ConfigField>
          {preview.target && (
            <ConfigField label={t("mcp.add.previewTarget")}>
              <span className="pw-mono" style={{ overflowWrap: "anywhere" }}>{preview.target}</span>
            </ConfigField>
          )}
          {preview.cwd && (
            <ConfigField label={t("mcp.fieldCwd")}>
              <span className="pw-mono" style={{ overflowWrap: "anywhere" }}>{preview.cwd}</span>
            </ConfigField>
          )}
          {/* env / header 只给**名字**，不给值（值可能是密钥）。 */}
          {/* env / header 只给**名字**（值可能是密钥，预览里也已掩码）。 */}
          {(preview.envNames.length > 0 || preview.headerNames.length > 0) && (
            <ConfigField label={t("mcp.fieldEnv")}>
              <span className="pw-mono">
                {[...preview.envNames, ...preview.headerNames].join(", ")}
              </span>
            </ConfigField>
          )}
          {preview.variableReferences.length > 0 && (
            <ConfigField label={t("mcp.add.previewVariables")}>
              <span className="pw-mono">
                {preview.variableReferences.map((entry) => `${entry.name ?? entry.kind}: ${entry.variables.join(",")}`).join("  ")}
              </span>
            </ConfigField>
          )}
          {preview.commandFields.length > 0 && (
            <ConfigField label={t("mcp.add.previewCommands")}>
              <span className="pw-mono" style={{ overflowWrap: "anywhere" }}>
                {preview.commandFields.map((entry) => entry.name ?? entry.kind).join(", ")}
              </span>
            </ConfigField>
          )}
          {preview.unfilled && (
            <div className="pw-alert info">
              <span className="pw-ico"><i data-ico="info" data-size="14"></i></span>
              <span className="pw-grow">{t("mcp.add.previewUnfilled")}</span>
            </div>
          )}
          <ConfigField label={t("mcp.fieldName")}>
            <input
              className="pw-input"
              value={draft.name ?? server?.name ?? ""}
              onChange={(event) => update({ name: event.target.value })}
              style={{ maxWidth: "calc(var(--s6) * 8)" }}
            />
          </ConfigField>
          <ConfigField label={t("mcp.fieldScope")}>
            <select
              className="pw-select"
              value={scope}
              onChange={(event) => onScopeChange(event.target.value as McpScope)}
            >
              <option value="global">{t("mcp.scope.global")}</option>
              <option value="project" disabled={!cwd}>{t("mcp.scope.project")}</option>
            </select>
          </ConfigField>
          <ConfigField label={t("mcp.fieldEnabled")}>
            <ConfigSwitch
              checked={preview.enabled}
              onChange={() => update({ enabled: !preview.enabled } as Partial<McpAddDraft>)}
              label={preview.enabled ? t("mcp.enable") : t("mcp.disable")}
            />
          </ConfigField>
        </>
      )}

      {actionError && (
        <div className="pw-alert bad">
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="14"></i></span>
          <span className="pw-grow">{actionError}</span>
        </div>
      )}

      {submitBlock && (
        <div className="pw-alert warn">
          <span className="pw-ico"><i data-ico="info" data-size="14"></i></span>
          <span className="pw-grow">{submitBlock}</span>
        </div>
      )}

      <div style={{ display: "flex", gap: "var(--s2)", justifyContent: "flex-end" }}>
        <button type="button" className="pw-btn" onClick={onCancel} disabled={busy}>
          {t("i18n.cancel")}
        </button>
        <button
          type="button"
          className="pw-btn primary"
          disabled={busy || Boolean(submitBlock)}
          onClick={() => onSubmit({ ...draft, scope })}
        >
          {busy ? t("mcp.add.pasting") : t("mcp.add.pasteSubmit")}
        </button>
      </div>
    </div>
  );
}