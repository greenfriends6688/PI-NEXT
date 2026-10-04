"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { PwaBanner, PwaSetRow } from "@/components/pwa/PwaPage";
import { PwaSheet } from "@/components/pwa/PwaSheet";
import type { McpScope } from "@/lib/api-types";
import {
  groupCatalogEntries,
  type McpCatalogEntry as CatalogEntry,
} from "@/lib/mcp-catalog";

/*
 * fork:proma-46-mcp-catalog — 「连接目录」的 UI。
 *
 * 数据与规则全在 lib/mcp-catalog.ts（纯函数，可单测）；这里只负责：
 *   - 按类展示目录卡片（`.d-slottable` / `.d-slotrow` 行，零新 `d-*` 类）；
 *   - OAuth 条目：先写配置，再开 `/api/mcp/catalog/oauth` 的 SSE（pi 的
 *     signInMcpServer），loopback 不可达时给一个粘贴 callback URL 的输入框；
 *   - credential 条目：一个 API Key 输入框，交给 `/api/mcp/catalog` 落盘
 *     （remote 进 headers，stdio 进 0600 凭据存储 + 命令绑定）；
 *   - cli 条目：只给官方入口，不写 mcp.json。
 */

interface CatalogDialogProps {
  open: boolean;
  cwd: string;
  scope: McpScope;
  onClose: () => void;
  onConfigured: () => void;
}

type OAuthPhase =
  | { phase: "idle" }
  | { phase: "waiting"; name: string }
  | { phase: "prompt"; name: string; token: string };

export function McpCatalogDialog({ open, cwd, scope, onClose, onConfigured }: CatalogDialogProps): ReactNode {
  const { t } = useI18n();
  const mobile = useIsMobile();
  const { dialogRef, dialogProps } = useDialogA11y({ open, onClose });
  const groups = useMemo(() => groupCatalogEntries(), []);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<CatalogEntry | null>(null);
  const [credential, setCredential] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [oauth, setOauth] = useState<OAuthPhase>({ phase: "idle" });
  // fork:v5-landing Wave B：手机档的分类 chip 选中项（横滚互斥，见 M-09 帧 A）。
  const [shownCategory, setShownCategory] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const closeEventSource = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, []);

  useEffect(() => () => closeEventSource(), [closeEventSource]);

  useEffect(() => {
    if (!open) {
      closeEventSource();
      setOauth({ phase: "idle" });
      setActive(null);
      setCredential("");
      setError(null);
      setMessage(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/mcp?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
        const data = (await res.json()) as { servers?: Array<{ name: string }> };
        if (!cancelled) setInstalled(new Set((data.servers ?? []).map((server) => server.name)));
      } catch {
        if (!cancelled) setInstalled(new Set());
      }
    })();
    return () => { cancelled = true; };
  }, [open, cwd, closeEventSource]);

  const configure = useCallback(async (entry: CatalogEntry, rawCredential?: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/mcp/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, scope, entryId: entry.id, credential: rawCredential }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return false;
      }
      setInstalled((current) => new Set([...current, entry.serverName]));
      setMessage(t("mcp.catalog.added", { name: entry.name }));
      setActive(null);
      setCredential("");
      onConfigured();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, [cwd, scope, onConfigured, t]);

  const startOAuth = useCallback(async (entry: CatalogEntry) => {
    const configured = await configure(entry);
    if (!configured) return;
    closeEventSource();
    setOauth({ phase: "waiting", name: entry.name });
    const es = new EventSource(
      `/api/mcp/catalog/oauth?cwd=${encodeURIComponent(cwd)}&scope=${scope}&name=${encodeURIComponent(entry.serverName)}`,
    );
    eventSourceRef.current = es;
    es.onmessage = (event) => {
      const data = JSON.parse(event.data) as { type: string; url?: string; token?: string; message?: string };
      if (data.type === "auth" && data.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
      } else if (data.type === "prompt" && data.token) {
        setOauth({ phase: "prompt", name: entry.name, token: data.token });
      } else if (data.type === "success") {
        es.close();
        eventSourceRef.current = null;
        setOauth({ phase: "idle" });
        setMessage(t("mcp.catalog.oauthSuccess", { name: entry.name }));
        onConfigured();
      } else if (data.type === "cancelled") {
        es.close();
        eventSourceRef.current = null;
        setOauth({ phase: "idle" });
      } else if (data.type === "error") {
        es.close();
        eventSourceRef.current = null;
        setOauth({ phase: "idle" });
        setError(data.message ?? t("mcp.catalog.oauthFailed", { name: entry.name }));
      }
    };
    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      setOauth((current) => (current.phase === "waiting" ? { phase: "idle" } : current));
    };
  }, [cwd, scope, configure, closeEventSource, onConfigured, t]);

  const submitRedirect = useCallback(async (token: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mcp/catalog/oauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: credential }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(data.error ?? `HTTP ${res.status}`);
      else setCredential("");
    } finally {
      setBusy(false);
    }
  }, [credential]);

  if (!open) return null;

  // fork:v5-landing Wave B · M-09 帧 A「插件商店」——
  // 手机上「连接目录」就是那张商店页的骨架：分类 chip 横滚互斥（`.m-cats` / `.m-cat`），
  // 分类标题 `.m-group-title`，条目 `.m-cardgroup` › `.m-setrow`。
  // **没有做的东西**：画板那张详情面板要逐条列权限（`.m-radio` 那一段），
  // 而目录条目本身没有权限数据 —— 不造，所以不画（缺件记在 Wave B 汇报里）。
  if (mobile) {
    const category = shownCategory ?? groups[0]?.category ?? "";
    const shown = groups.filter((group) => group.category === category);
    return (
      <PwaSheet
        open
        title={t("mcp.catalog.title")}
        label={t("mcp.catalog.title")}
        onClose={onClose}
        footer={
          <button type="button" className="m-picktag" onClick={onClose}>
            {t("mcp.catalog.close")}
          </button>
        }
      >
        <PwaBanner icon="info">{t("mcp.catalog.subtitle")}</PwaBanner>
        {message && <PwaBanner icon="circle-check">{message}</PwaBanner>}
        {error && <PwaBanner icon="triangle-alert" tone="err" role="alert">{error}</PwaBanner>}

        <div className="m-cats">
          {groups.map((group) => (
            <button
              key={group.category}
              type="button"
              className={`m-cat${group.category === category ? " is-on" : ""}`}
              aria-pressed={group.category === category}
              onClick={() => setShownCategory(group.category)}
            >
              {t(`mcp.catalog.category.${group.category}`)}
            </button>
          ))}
        </div>

        {shown.map((group) => (
          <Fragment key={group.category}>
            <div className="m-group-title">{t(`mcp.catalog.category.${group.category}`)}</div>
            <div className="m-cardgroup">
              {group.entries.map((entry) => (
                <PwaSetRow
                  key={entry.id}
                  icon={entry.category === "cli" ? "terminal" : entry.requiresCredential ? "key-round" : "server"}
                  label={entry.name}
                  sub={t(entry.descriptionKey)}
                  trailing={
                    <>
                      {installed.has(entry.serverName) && (
                        <span className="m-badge ok">{t("mcp.catalog.installed")}</span>
                      )}
                      {entry.category === "cli" ? (
                        <button
                          type="button"
                          className="m-btn sm"
                          onClick={() => window.open(entry.setupUrl, "_blank", "noopener,noreferrer")}
                        >
                          <i data-ico="external-link" data-size="14" aria-hidden="true" />
                          {t("mcp.catalog.openSetup")}
                        </button>
                      ) : entry.oauth ? (
                        <button
                          type="button"
                          className="m-btn sm"
                          disabled={busy || oauth.phase === "waiting"}
                          onClick={() => void startOAuth(entry)}
                        >
                          <i data-ico="key-round" data-size="14" aria-hidden="true" />
                          {oauth.phase === "waiting" && oauth.name === entry.name
                            ? t("mcp.catalog.oauthWaiting", { name: entry.name })
                            : t("mcp.catalog.authorize")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="m-btn sm"
                          disabled={busy}
                          onClick={() => { setActive(entry); setCredential(""); setError(null); setMessage(null); }}
                        >
                          <i data-ico="wrench" data-size="14" aria-hidden="true" />
                          {t("mcp.catalog.configure")}
                        </button>
                      )}
                    </>
                  }
                />
              ))}
            </div>
          </Fragment>
        ))}

        {active && (
          <Fragment>
            <div className="m-group-title">{t("mcp.catalog.keyLabel", { name: active.name })}</div>
            <div className="m-cardgroup">
              <PwaSetRow
                label={active.credential?.headerName ?? active.credential?.envName ?? ""}
              />
              <div className="m-doc-body">
                <input
                  className="m-input"
                  style={{ width: "100%" }}
                  value={credential}
                  onChange={(event) => setCredential(event.target.value)}
                  placeholder={t("mcp.catalog.keyPlaceholder")}
                  autoComplete="off"
                />
              </div>
              <div className="m-pickbar">
                <button type="button" className="m-picktag" onClick={() => setActive(null)}>
                  {t("i18n.cancel")}
                </button>
                <button
                  type="button"
                  className="m-picktag is-on"
                  disabled={busy || !credential.trim()}
                  onClick={() => void configure(active, credential)}
                >
                  {busy ? t("mcp.catalog.saving") : t("mcp.catalog.save")}
                </button>
              </div>
              <PwaSetRow label={t("mcp.catalog.keyHint")} />
            </div>
          </Fragment>
        )}

        {oauth.phase === "prompt" && (
          <Fragment>
            <div className="m-group-title">{t("mcp.catalog.oauthPaste")}</div>
            <div className="m-cardgroup">
              <PwaSetRow label={t("mcp.catalog.oauthPasteLabel")} />
              <div className="m-doc-body">
                <input
                  className="m-input"
                  style={{ width: "100%" }}
                  value={credential}
                  onChange={(event) => setCredential(event.target.value)}
                  placeholder={t("mcp.catalog.oauthPastePlaceholder")}
                  autoComplete="off"
                />
              </div>
              <div className="m-pickbar">
                <button
                  type="button"
                  className="m-picktag is-on"
                  disabled={busy || !credential.trim()}
                  onClick={() => void submitRedirect(oauth.token)}
                >
                  {t("mcp.catalog.oauthPasteSubmit")}
                </button>
              </div>
            </div>
          </Fragment>
        )}
      </PwaSheet>
    );
  }

  // fork:v5-landing D-15 帧 A/F「连接目录」—— 壳走 `.d-modal` / `.d-modal-box`，
  // 条目列表走 `.d-slottable` / `.d-slotrow`（与画板 D-15 帧 D 的登录态同一组），
  // 类别标题是 `.d-set-sec-t`，凭据输入走 `.d-card` + `.d-field`。
  // `fork-pwa-import-scrim` / `fork-pwa-import` 是 app/pwa-plugins-agents.css 仍在用的
  // 手机档选择器，保留并注释。
  return (
    <div
      ref={dialogRef}
      {...dialogProps}
      aria-label={t("mcp.catalog.title")}
      className="d-modal is-open fork-pwa-import-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="d-modal-box wide fork-pwa-import">
        <div className="d-modal-head d-row">
          <i data-ico="plug" data-size="16" aria-hidden="true" />
          <span className="d-grow">{t("mcp.catalog.title")}</span>
          <button type="button" className="d-iconbtn" onClick={onClose} title={t("i18n.close")} aria-label={t("i18n.close")}>
            <i data-ico="x" data-size="14" aria-hidden="true" />
          </button>
        </div>

        <div className="d-modal-body" style={{ flex: "1 1 0%", minHeight: 0 }}>
          <p className="d-t-xs d-t-faint">{t("mcp.catalog.subtitle")}</p>
          {message && (
            <div className="d-banner ok">
              <i data-ico="circle-check" data-size="14" aria-hidden="true" />
              <span className="d-grow">{message}</span>
            </div>
          )}
          {error && (
            <div className="d-banner err">
              <i data-ico="triangle-alert" data-size="14" aria-hidden="true" />
              <span className="d-grow">{error}</span>
            </div>
          )}

          {groups.map((group) => (
            <div className="d-set-sec" key={group.category}>
              <div className="d-set-sec-t">{t(`mcp.catalog.category.${group.category}`)}</div>
              <div className="d-slottable">
                {group.entries.map((entry) => (
                  <div key={entry.id} className="d-slotrow">
                    <div className="d-ava">
                      <i
                        data-ico={entry.category === "cli" ? "terminal" : entry.requiresCredential ? "key-round" : "server"}
                        data-size="14"
                        aria-hidden="true"
                      />
                    </div>
                    <div className="d-col d-grow">
                      <div className="d-row">
                        <span className="d-t-b">{entry.name}</span>
                        {installed.has(entry.serverName) && <span className="d-badge ok">{t("mcp.catalog.installed")}</span>}
                      </div>
                      <span className="d-set-row-s">{t(entry.descriptionKey)}</span>
                    </div>
                    {entry.category === "cli" ? (
                      <button
                        type="button"
                        className="d-btn sm"
                        onClick={() => window.open(entry.setupUrl, "_blank", "noopener,noreferrer")}
                      >
                        <i data-ico="external-link" data-size="14" aria-hidden="true" />
                        {t("mcp.catalog.openSetup")}
                      </button>
                    ) : entry.oauth ? (
                      <button
                        type="button"
                        className="d-btn sm"
                        disabled={busy || oauth.phase === "waiting"}
                        onClick={() => void startOAuth(entry)}
                      >
                        <i data-ico="key-round" data-size="14" aria-hidden="true" />
                        {oauth.phase === "waiting" && oauth.name === entry.name ? t("mcp.catalog.oauthWaiting", { name: entry.name }) : t("mcp.catalog.authorize")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="d-btn sm"
                        disabled={busy}
                        onClick={() => { setActive(entry); setCredential(""); setError(null); setMessage(null); }}
                      >
                        <i data-ico="wrench" data-size="14" aria-hidden="true" />
                        {t("mcp.catalog.configure")}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {active && (
            <div className="d-card">
              <div className="d-card-head">
                <i data-ico="key-round" data-size="15" aria-hidden="true" />
                <span className="d-grow">{t("mcp.catalog.keyLabel", { name: active.name })}</span>
              </div>
              <div className="d-card-body">
                <div className="d-field">
                  <span className="d-field-t">{active.credential?.headerName ?? active.credential?.envName ?? ""}</span>
                  <div className="d-row">
                    <input
                      className="d-input"
                      value={credential}
                      onChange={(event) => setCredential(event.target.value)}
                      placeholder={t("mcp.catalog.keyPlaceholder")}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="d-btn sm primary"
                      disabled={busy || !credential.trim()}
                      onClick={() => void configure(active, credential)}
                    >
                      {busy ? t("mcp.catalog.saving") : t("mcp.catalog.save")}
                    </button>
                  </div>
                </div>
                <p className="d-t-xs d-t-faint">{t("mcp.catalog.keyHint")}</p>
              </div>
            </div>
          )}

          {oauth.phase === "prompt" && (
            <div className="d-card">
              <div className="d-card-head">
                <i data-ico="key-round" data-size="15" aria-hidden="true" />
                <span className="d-grow">{t("mcp.catalog.oauthPaste")}</span>
              </div>
              <div className="d-card-body">
                <div className="d-field">
                  <span className="d-field-t">{t("mcp.catalog.oauthPasteLabel")}</span>
                  <div className="d-row">
                    <input
                      className="d-input"
                      value={credential}
                      onChange={(event) => setCredential(event.target.value)}
                      placeholder={t("mcp.catalog.oauthPastePlaceholder")}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="d-btn sm primary"
                      disabled={busy || !credential.trim()}
                      onClick={() => void submitRedirect(oauth.token)}
                    >
                      {t("mcp.catalog.oauthPasteSubmit")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="d-modal-foot">
          <span className="d-grow" />
          <button type="button" className="d-btn sm" onClick={onClose}>
            {t("mcp.catalog.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 目录入口（放在 MCP 设置页页头）。自身不占布局：按钮 + 弹层。
 */
export function McpCatalogEntry({ cwd, scope, onReloaded }: {
  cwd: string | null;
  scope?: McpScope;
  onReloaded?: () => void;
}): ReactNode {
  const { t } = useI18n();
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={mobile ? "m-btn sm" : "d-btn sm"}
        onClick={() => setOpen(true)}
        disabled={!cwd}
      >
        <i data-ico="plug" data-size="14" aria-hidden="true" />
        {t("mcp.catalog.open")}
      </button>
      <McpCatalogDialog
        open={open}
        cwd={cwd ?? ""}
        scope={scope ?? "global"}
        onClose={() => setOpen(false)}
        onConfigured={() => onReloaded?.()}
      />
    </>
  );
}
