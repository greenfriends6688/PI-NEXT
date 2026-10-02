"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ConfigBadge, ConfigButton, ConfigSectionTitle } from "../SettingsUi";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useI18n } from "@/hooks/useI18n";
import type { McpScope } from "@/lib/api-types";
import {
  groupCatalogEntries,
  type McpCatalogEntry as CatalogEntry,
} from "@/lib/mcp-catalog";

/*
 * fork:proma-46-mcp-catalog — 「连接目录」的 UI。
 *
 * 数据与规则全在 lib/mcp-catalog.ts（纯函数，可单测）；这里只负责：
 *   - 按类展示目录卡片（`.pw-prow` 行，无新 `pw-*` 类）；
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
  const { dialogRef, dialogProps } = useDialogA11y({ open, onClose });
  const groups = useMemo(() => groupCatalogEntries(), []);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<CatalogEntry | null>(null);
  const [credential, setCredential] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [oauth, setOauth] = useState<OAuthPhase>({ phase: "idle" });
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

  return (
    <div
      ref={dialogRef}
      {...dialogProps}
      aria-label={t("mcp.catalog.title")}
      className="fork-pwa-import-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="pw-modal fork-pwa-import">
        <div className="pw-modal-head">
          <span className="pw-ico"><i data-ico="plug" data-size="16"></i></span>
          {t("mcp.catalog.title")}
          <span className="pw-grow" aria-hidden="true" />
          <button type="button" className="pw-iconbtn" onClick={onClose} title={t("i18n.close")} aria-label={t("i18n.close")}>
            <span className="pw-ico"><i data-ico="x" data-size="14"></i></span>
          </button>
        </div>

        <div className="pw-modal-body" style={{ flex: "1 1 0%", minHeight: 0, gridTemplateColumns: "minmax(0, 1fr)" }}>
          <p className="pw-hint">{t("mcp.catalog.subtitle")}</p>
          {message && (
            <div className="pw-alert info">
              <span className="pw-ico"><i data-ico="check" data-size="14"></i></span>
              <span className="pw-grow">{message}</span>
            </div>
          )}
          {error && (
            <div className="pw-alert">
              <span className="pw-ico"><i data-ico="triangle-alert" data-size="14"></i></span>
              <span className="pw-grow">{error}</span>
            </div>
          )}

          {groups.map((group) => (
            <div key={group.category}>
              <ConfigSectionTitle>{t(`mcp.catalog.category.${group.category}`)}</ConfigSectionTitle>
              {group.entries.map((entry) => (
                <div key={entry.id} className="pw-prow">
                  <span className="pw-ico">
                    <i data-ico={entry.category === "cli" ? "terminal" : entry.requiresCredential ? "key-round" : "server"} data-size="14"></i>
                  </span>
                  <span className="grow">
                    <b>{entry.name}</b>
                    <div className="pw-desc">{t(entry.descriptionKey)}</div>
                  </span>
                  {installed.has(entry.serverName) && <ConfigBadge tone="ok">{t("mcp.catalog.installed")}</ConfigBadge>}
                  {entry.category === "cli" ? (
                    <ConfigButton
                      variant="secondary"
                      size="small"
                      onClick={() => window.open(entry.setupUrl, "_blank", "noopener,noreferrer")}
                    >
                      <span className="pw-ico"><i data-ico="external-link" data-size="13"></i></span>
                      {t("mcp.catalog.openSetup")}
                    </ConfigButton>
                  ) : entry.oauth ? (
                    <ConfigButton
                      variant="secondary"
                      size="small"
                      disabled={busy || oauth.phase === "waiting"}
                      onClick={() => void startOAuth(entry)}
                    >
                      <span className="pw-ico"><i data-ico="key-round" data-size="13"></i></span>
                      {oauth.phase === "waiting" && oauth.name === entry.name ? t("mcp.catalog.oauthWaiting", { name: entry.name }) : t("mcp.catalog.authorize")}
                    </ConfigButton>
                  ) : (
                    <ConfigButton
                      variant="secondary"
                      size="small"
                      disabled={busy}
                      onClick={() => { setActive(entry); setCredential(""); setError(null); setMessage(null); }}
                    >
                      <span className="pw-ico"><i data-ico="wrench" data-size="13"></i></span>
                      {t("mcp.catalog.configure")}
                    </ConfigButton>
                  )}
                </div>
              ))}
            </div>
          ))}

          {active && (
            <div className="pw-card">
              <div className="pw-card-head">
                <span className="pw-ico"><i data-ico="key-round" data-size="14"></i></span>
                <span className="pw-tool">{t("mcp.catalog.keyLabel", { name: active.name })}</span>
              </div>
              <div className="pw-card-body">
                <div className="pw-field">
                  <span className="pw-label">{active.credential?.headerName ?? active.credential?.envName ?? ""}</span>
                  <span className="pw-ctl">
                    <input
                      className="pw-input"
                      value={credential}
                      onChange={(event) => setCredential(event.target.value)}
                      placeholder={t("mcp.catalog.keyPlaceholder")}
                      autoComplete="off"
                    />
                    <ConfigButton
                      variant="primary"
                      size="small"
                      disabled={busy || !credential.trim()}
                      onClick={() => void configure(active, credential)}
                    >
                      {busy ? t("mcp.catalog.saving") : t("mcp.catalog.save")}
                    </ConfigButton>
                  </span>
                </div>
                <p className="pw-hint">{t("mcp.catalog.keyHint")}</p>
              </div>
            </div>
          )}

          {oauth.phase === "prompt" && (
            <div className="pw-card">
              <div className="pw-card-head">
                <span className="pw-ico"><i data-ico="key-round" data-size="14"></i></span>
                <span className="pw-tool">{t("mcp.catalog.oauthPaste")}</span>
              </div>
              <div className="pw-card-body">
                <div className="pw-field">
                  <span className="pw-label">{t("mcp.catalog.oauthPasteLabel")}</span>
                  <span className="pw-ctl">
                    <input
                      className="pw-input"
                      value={credential}
                      onChange={(event) => setCredential(event.target.value)}
                      placeholder={t("mcp.catalog.oauthPastePlaceholder")}
                      autoComplete="off"
                    />
                    <ConfigButton
                      variant="primary"
                      size="small"
                      disabled={busy || !credential.trim()}
                      onClick={() => void submitRedirect(oauth.token)}
                    >
                      {t("mcp.catalog.oauthPasteSubmit")}
                    </ConfigButton>
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="pw-modal-foot">
          <span className="grow" aria-hidden="true" />
          <ConfigButton variant="secondary" size="small" onClick={onClose}>
            {t("mcp.catalog.close")}
          </ConfigButton>
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
  const [open, setOpen] = useState(false);
  return (
    <>
      <ConfigButton
        variant="secondary"
        size="small"
        onClick={() => setOpen(true)}
        disabled={!cwd}
      >
        <span className="pw-ico"><i data-ico="plug" data-size="13" aria-hidden="true" /></span>
        {t("mcp.catalog.open")}
      </ConfigButton>
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
