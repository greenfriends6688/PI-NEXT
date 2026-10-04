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
import { Fragment } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { PwaBanner, PwaPickSelect, PwaSetRow } from "@/components/pwa/PwaPage";
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
  const mobile = useIsMobile();
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

  // fork:v5-landing Wave B · M-09 帧 B 表单形态 ——
  // 窄屏上这一段整体落在底部面板里：分节 `.m-cardgroup` + `.m-group-title`，
  // 字段行 `.m-setrow` / 控件槽 `.m-doc-body`，示例 chip 走 `.m-chips` / `.m-chipbtn`
  // （与 M-05 帧 B 的同一组）。解析、预检、提交口径与桌面**完全相同**。
  if (mobile) {
    return (
      <Fragment>
        <div className="m-cardgroup">
          <div className="m-group-title">{t("mcp.add.pasteLabel")}</div>
          <div className="m-doc-body">
            <textarea
              className="m-input"
              /* `.m-input` 的高度锁在 44px，粘贴框需要多行。 */
              style={{ width: "100%", height: "auto", fontFamily: "var(--nx-font-mono)" }}
              rows={5}
              spellCheck={false}
              value={draft.text}
              placeholder={t("mcp.add.pastePlaceholder")}
              onChange={(event) => {
                update({ text: event.target.value });
                setShowExamples(false);
              }}
              onPaste={() => setShowExamples(false)}
            />
          </div>
          {showExamples && !draft.text.trim() && (
            <Fragment>
              <PwaSetRow label={t("mcp.add.pasteExamples")} />
              <div className="m-doc-body">
                <div className="m-chips">
                  {MCP_ADD_EXAMPLES.map((example) => (
                    <button
                      key={`${example.source}-${example.text}`}
                      type="button"
                      className="m-chipbtn"
                      onClick={() => { update({ text: example.text }); setShowExamples(false); }}
                    >
                      {t(MCP_IMPORT_SOURCE_KEYS[example.source])}
                    </button>
                  ))}
                </div>
              </div>
            </Fragment>
          )}
          {parsed && "servers" in parsed && parsed.ok && parsed.servers.length > 1 && (
            <Fragment>
              <PwaSetRow label={t("mcp.add.serverCount", { count: parsed.servers.length })} />
              <div className="m-doc-body">
                {/* fork:v5-landing · M-05 帧 B —— 设置里的「从若干值里选一个」
                    一律用 `.m-pickselect`（壳 + 裸 `<select>` + 壳画的 chevron），
                    下拉交给系统；不再拿 `.m-input` 硬套一个原生 select。
                    选项与写盘口径一字不变。 */}
                <PwaPickSelect
                  value={String(draft.server)}
                  ariaLabel={t("mcp.add.serverCount", { count: parsed.servers.length })}
                  options={parsed.servers.map((entry, index) => ({ value: String(index), label: entry.name }))}
                  onChange={(value) => update({ server: Number(value) })}
                />
              </div>
            </Fragment>
          )}
          {parsed && !parsed.ok && (
            <PwaBanner icon="triangle-alert" tone="warn">{t("mcp.add.pasteUnreadable")}</PwaBanner>
          )}
          {parsed && "notes" in parsed && parsed.notes.length > 0 && (
            <PwaBanner icon="info">
              {parsed.notes.map((note) => (
                <span key={note.code}>
                  {mcpImportNoteSeverity(note) === "error"
                    ? t(mcpImportProblemKey(note as unknown as Record<string, string | number>))
                    : note.code}
                </span>
              ))}
            </PwaBanner>
          )}
        </div>

        {preview && (
          <div className="m-cardgroup">
            <div className="m-group-title">{t("mcp.add.previewTarget")}</div>
            <PwaSetRow label={t("mcp.fieldType")} sub={preview.transport === "http" ? "http" : "stdio"} />
            {preview.target && <PwaSetRow label={t("mcp.add.previewTarget")} sub={preview.target} />}
            {preview.cwd && <PwaSetRow label={t("mcp.fieldCwd")} sub={preview.cwd} />}
            {/* env / header 只给名字，不给值（值可能是密钥）。 */}
            {(preview.envNames.length > 0 || preview.headerNames.length > 0) && (
              <PwaSetRow
                label={t("mcp.fieldEnv")}
                sub={[...preview.envNames, ...preview.headerNames].join(", ")}
              />
            )}
            {preview.variableReferences.length > 0 && (
              <PwaSetRow
                label={t("mcp.add.previewVariables")}
                sub={preview.variableReferences
                  .map((entry) => `${entry.name ?? entry.kind}: ${entry.variables.join(",")}`)
                  .join("  ")}
              />
            )}
            {preview.commandFields.length > 0 && (
              <PwaSetRow
                label={t("mcp.add.previewCommands")}
                sub={preview.commandFields.map((entry) => entry.name ?? entry.kind).join(", ")}
              />
            )}
            {preview.unfilled && <PwaBanner icon="info">{t("mcp.add.previewUnfilled")}</PwaBanner>}
            <PwaSetRow label={t("mcp.fieldName")} />
            <div className="m-doc-body">
              <input
                className="m-input"
                style={{ width: "100%" }}
                value={draft.name ?? server?.name ?? ""}
                onChange={(event) => update({ name: event.target.value })}
              />
            </div>
            <PwaSetRow label={t("mcp.fieldScope")} />
            <div className="m-doc-body">
              <PwaPickSelect
                value={scope}
                ariaLabel={t("mcp.fieldScope")}
                options={[
                  { value: "global", label: t("mcp.scope.global") },
                  { value: "project", label: t("mcp.scope.project"), disabled: !cwd },
                ]}
                onChange={(value) => onScopeChange(value as McpScope)}
              />
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={preview.enabled}
              aria-label={preview.enabled ? t("mcp.enable") : t("mcp.disable")}
              className={`m-switch${preview.enabled ? " on" : ""}`}
              onClick={() => update({ enabled: !preview.enabled } as Partial<McpAddDraft>)}
            />
          </div>
        )}

        {actionError && <PwaBanner icon="triangle-alert" tone="err" role="alert">{actionError}</PwaBanner>}
        {submitBlock && <PwaBanner icon="info" tone="warn">{submitBlock}</PwaBanner>}

        <div className="m-pickbar">
          <button type="button" className="m-picktag" onClick={onCancel} disabled={busy}>
            {t("i18n.cancel")}
          </button>
          <button
            type="button"
            className="m-picktag is-on"
            disabled={busy || Boolean(submitBlock)}
            onClick={() => onSubmit({ ...draft, scope })}
          >
            {busy ? t("mcp.add.pasting") : t("mcp.add.pasteSubmit")}
          </button>
        </div>
      </Fragment>
    );
  }

  // fork:v5-landing D-15 帧 B「粘贴添加」/ 帧 C「解析结果」——
  // 表单字段走 `.d-field` + `.d-input`/`.d-textarea`/`.d-select`，状态条走 `.d-banner`，
  // 示例与页脚动作走 `.d-chips`/`.d-chipbtn` 与 `.d-btn`。行为与文案一律不动。
  return (
    <div className="d-col" style={{ gap: "var(--nx-sp-3)" }}>
      <div className="d-field">
        <span className="d-field-t">{t("mcp.add.pasteLabel")}</span>
        <textarea
          className="d-textarea"
          rows={5}
          spellCheck={false}
          value={draft.text}
          placeholder={t("mcp.add.pastePlaceholder")}
          onChange={(event) => {
            update({ text: event.target.value });
            setShowExamples(false);
          }}
          onPaste={() => setShowExamples(false)}
          style={{ minHeight: "calc(var(--nx-sp-6) * 6)", resize: "vertical", fontFamily: "var(--nx-font-mono)" }}
        />
      </div>

      {/* 上游同款：空框时列出每种格式一个示例，点一下就填进来。 */}
      {showExamples && !draft.text.trim() && (
        <div className="d-col" style={{ gap: "var(--nx-sp-2)" }}>
          <div className="d-t-xs d-t-faint">{t("mcp.add.pasteExamples")}</div>
          <div className="d-chips">
            {MCP_ADD_EXAMPLES.map((example) => (
              <button
                key={`${example.source}-${example.text}`}
                type="button"
                className="d-chipbtn"
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
        <div className="d-field">
          <span className="d-field-t">{t("mcp.add.serverCount", { count: parsed.servers.length })}</span>
          <select
            className="d-select"
            value={draft.server}
            onChange={(event) => update({ server: Number(event.target.value) })}
          >
            {parsed.servers.map((entry, index) => (
              <option key={`${entry.name}-${index}`} value={index}>{entry.name}</option>
            ))}
          </select>
        </div>
      )}

      {parsed && !parsed.ok && (
        <div className="d-banner warn">
          <i data-ico="triangle-alert" data-size="14" aria-hidden="true" />
          <span className="d-grow">{t("mcp.add.pasteUnreadable")}</span>
        </div>
      )}

      {parsed && "notes" in parsed && parsed.notes.length > 0 && (
        <div className="d-banner info">
          <i data-ico="info" data-size="14" aria-hidden="true" />
          <span className="d-grow">
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
          <div className="d-field">
            <span className="d-field-t">{t("mcp.fieldType")}</span>
            <span className="d-mono">{preview.transport === "http" ? "http" : "stdio"}</span>
          </div>
          {preview.target && (
            <div className="d-field">
              <span className="d-field-t">{t("mcp.add.previewTarget")}</span>
              <span className="d-mono" style={{ overflowWrap: "anywhere" }}>{preview.target}</span>
            </div>
          )}
          {preview.cwd && (
            <div className="d-field">
              <span className="d-field-t">{t("mcp.fieldCwd")}</span>
              <span className="d-mono" style={{ overflowWrap: "anywhere" }}>{preview.cwd}</span>
            </div>
          )}
          {/* env / header 只给**名字**，不给值（值可能是密钥）。 */}
          {/* env / header 只给**名字**（值可能是密钥，预览里也已掩码）。 */}
          {(preview.envNames.length > 0 || preview.headerNames.length > 0) && (
            <div className="d-field">
              <span className="d-field-t">{t("mcp.fieldEnv")}</span>
              <span className="d-mono">
                {[...preview.envNames, ...preview.headerNames].join(", ")}
              </span>
            </div>
          )}
          {preview.variableReferences.length > 0 && (
            <div className="d-field">
              <span className="d-field-t">{t("mcp.add.previewVariables")}</span>
              <span className="d-mono">
                {preview.variableReferences.map((entry) => `${entry.name ?? entry.kind}: ${entry.variables.join(",")}`).join("  ")}
              </span>
            </div>
          )}
          {preview.commandFields.length > 0 && (
            <div className="d-field">
              <span className="d-field-t">{t("mcp.add.previewCommands")}</span>
              <span className="d-mono" style={{ overflowWrap: "anywhere" }}>
                {preview.commandFields.map((entry) => entry.name ?? entry.kind).join(", ")}
              </span>
            </div>
          )}
          {preview.unfilled && (
            <div className="d-banner info">
              <i data-ico="info" data-size="14" aria-hidden="true" />
              <span className="d-grow">{t("mcp.add.previewUnfilled")}</span>
            </div>
          )}
          <div className="d-field">
            <span className="d-field-t">{t("mcp.fieldName")}</span>
            <input
              className="d-input"
              value={draft.name ?? server?.name ?? ""}
              onChange={(event) => update({ name: event.target.value })}
              style={{ maxWidth: "calc(var(--nx-sp-8) * 8)" }}
            />
          </div>
          <div className="d-field">
            <span className="d-field-t">{t("mcp.fieldScope")}</span>
            <select
              className="d-select"
              value={scope}
              onChange={(event) => onScopeChange(event.target.value as McpScope)}
            >
              <option value="global">{t("mcp.scope.global")}</option>
              <option value="project" disabled={!cwd}>{t("mcp.scope.project")}</option>
            </select>
          </div>
          <div className="d-field">
            <span className="d-field-t">{t("mcp.fieldEnabled")}</span>
            <button
              type="button"
              role="switch"
              aria-checked={preview.enabled}
              aria-label={preview.enabled ? t("mcp.enable") : t("mcp.disable")}
              className={`d-switch${preview.enabled ? " on" : ""}`}
              onClick={() => update({ enabled: !preview.enabled } as Partial<McpAddDraft>)}
            />
          </div>
        </>
      )}

      {actionError && (
        <div className="d-banner err">
          <i data-ico="triangle-alert" data-size="14" aria-hidden="true" />
          <span className="d-grow">{actionError}</span>
        </div>
      )}

      {submitBlock && (
        <div className="d-banner warn">
          <i data-ico="info" data-size="14" aria-hidden="true" />
          <span className="d-grow">{submitBlock}</span>
        </div>
      )}

      <div className="d-row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="d-btn sm" onClick={onCancel} disabled={busy}>
          {t("i18n.cancel")}
        </button>
        <button
          type="button"
          className="d-btn sm primary"
          disabled={busy || Boolean(submitBlock)}
          onClick={() => onSubmit({ ...draft, scope })}
        >
          {busy ? t("mcp.add.pasting") : t("mcp.add.pasteSubmit")}
        </button>
      </div>
    </div>
  );
}