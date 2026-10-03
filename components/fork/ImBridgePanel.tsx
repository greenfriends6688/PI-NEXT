"use client";

import { useCallback, useEffect, useState } from "react";

import { useI18n } from "@/hooks/useI18n";
// fork:client-graph-purity —— 只能 import `-shared` 那半边：实现留服务端
// （`lib/im-bridge.ts` 要 node:fs / pi SDK，拖进客户端图会让 build 红）。
import {
  IM_PROVIDER_IDS,
  detectImProvider,
  needsImChatId,
  needsImSecret,
  type ImProvider,
} from "@/lib/im-bridge-shared";
import { ConfigButton, ConfigListAction, ConfigSwitch } from "../SettingsUi";

/**
 * fork:im-bridge —— IM 群机器人目标的管理页。
 *
 * 全部用画板已有原子（`.pw-list` / `.pw-litem` / `.pw-field` / `.pw-input` /
 * `.pw-select` / `.pw-alert` / `ConfigSwitch` / `ConfigButton`），不新增 `pw-*` 类。
 *
 * **两条不能省的 UX**：
 * · **测试发送**是这类配置唯一的验收方式 —— 粘贴来的 webhook 对不对、平台认不认、
 *   加签过不过，只有真发一条才知道。所以每行都有「试一下」。
 * · **平台自动识别**但可手改：用户粘的 URL 认不出来时落 `custom`，而 `custom` 是
 *   「原样 POST」，所以平台没收录也能用，不必等本仓更新。
 */

interface TargetRow {
  id: string;
  label: string;
  provider: ImProvider;
  url: string;
  secret: string;
  chatId: string;
  enabled: boolean;
}

type ServerTarget = Omit<TargetRow, "url"> & { host: string };

const PROVIDER_LABELS: Record<ImProvider, string> = {
  feishu: "飞书 / Lark",
  wecom: "企业微信",
  dingtalk: "钉钉",
  slack: "Slack",
  telegram: "Telegram",
  custom: "自定义 webhook",
};

const PROVIDER_HINTS: Record<ImProvider, string> = {
  feishu: "群「添加机器人 → 自定义机器人」，安全设置可开签名校验（SEC 开头那串）。",
  wecom: "群「群机器人 → 添加」，只有 key，没有加签；官方文档也没写签名。",
  dingtalk: "群机器人「安全设置 → 加签」里的 SEC 串；注意时间戳是毫秒。",
  slack: "incoming webhook 的整条 URL 就是凭证，没有加签。",
  telegram: "BotFather 给的 token 拼成 URL，另外还要填 chat id（URL 里不带）。",
  custom: "任何收 POST JSON 的地址：固定发 {title?, text}。",
};

function emptyRow(): TargetRow {
  return { id: crypto.randomUUID(), label: "", provider: "feishu", url: "", secret: "", chatId: "", enabled: true };
}

export function ImBridgeBody() {
  const { t } = useI18n();
  const [rows, setRows] = useState<TargetRow[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void fetch("/api/im-bridge")
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ targets: ServerTarget[] }>;
      })
      .then((payload) => {
        setRows(payload.targets.map((target) => ({
          id: target.id,
          label: target.label,
          provider: target.provider,
          // 服务器只回 host（URL 是凭证）：把 host 摆回输入框，用户自己粘全的那条还在
          // 剪贴板/浏览器自动填充里；已保存的那条改别的字段时也不会被清空。
          url: "",
          secret: target.secret ?? "",
          chatId: target.chatId ?? "",
          enabled: target.enabled,
        })));
        setLoaded(true);
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoaded(true);
      });
  }, []);

  const save = useCallback(async (next: TargetRow[]) => {
    setBusy("save");
    setError(null);
    try {
      const response = await fetch("/api/im-bridge", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // 空 url 的行表示「这条没改 URL」，服务器按 id 沿用已存的那条。
        body: JSON.stringify({ targets: next }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `HTTP ${response.status}`);
      setStatus(t("imBridge.saved"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, [t]);

  const test = useCallback(async (row: TargetRow) => {
    setBusy(row.id);
    setError(null);
    setStatus(null);
    try {
      // 测试发送走**已保存**的那条配置：URL 是凭证，不在掩码视图里回传，
      // 所以先落盘再发，发出去的才是用户真正会用到的那条。
      await save(rows);
      const response = await fetch("/api/im-bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, text: t("imBridge.testBody") }),
      });
      const outcome = await response.json() as { ok?: boolean; detail?: string };
      if (!response.ok || !outcome.ok) throw new Error(outcome.detail ?? `HTTP ${response.status}`);
      setStatus(t("imBridge.testOk", { label: row.label || PROVIDER_LABELS[row.provider] }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, [rows, save, t]);

  const patch = (id: string, changes: Partial<TargetRow>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...changes } : row)));
    setStatus(null);
  };

  return (
    <div style={{ display: "grid", gap: "var(--s3)" }}>
      {error && (
        <div className="pw-alert" role="alert" style={{ margin: 0 }}>
          <span className="pw-ico"><i data-ico="circle-x" data-size="14" aria-hidden="true" /></span>
          <span>{error}</span>
        </div>
      )}
      {status && !error && (
        <div className="pw-alert info" role="status" style={{ margin: 0 }}>
          <span className="pw-ico"><i data-ico="circle-check" data-size="14" aria-hidden="true" /></span>
          <span>{status}</span>
        </div>
      )}

      <div className="pw-list">
        {rows.map((row) => (
          <div key={row.id} className="pw-litem" style={{ display: "grid", gap: "var(--s2)" }}>
            <div className="pw-field">
              <span className="pw-label">{t("imBridge.name")}</span>
              <span className="pw-ctl">
                <input
                  className="pw-input"
                  value={row.label}
                  placeholder={PROVIDER_LABELS[row.provider]}
                  onChange={(event) => patch(row.id, { label: event.target.value })}
                />
              </span>
            </div>
            <div className="pw-field">
              <span className="pw-label">
                {t("imBridge.webhook")}
                <small>{PROVIDER_HINTS[row.provider]}</small>
              </span>
              <span className="pw-ctl">
                <select
                  className="pw-select"
                  value={row.provider}
                  aria-label={t("imBridge.platform")}
                  onChange={(event) => patch(row.id, { provider: event.target.value as ImProvider })}
                >
                  {IM_PROVIDER_IDS.map((provider) => (
                    <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>
                  ))}
                </select>
              </span>
            </div>
            <div className="pw-field">
              <span className="pw-label">{t("imBridge.url")}</span>
              <span className="pw-ctl">
                <input
                  className="pw-input pw-mono"
                  type="password"
                  autoComplete="off"
                  value={row.url}
                  placeholder={row.url ? "••••••（已保存）" : "https://…"}
                  onChange={(event) => {
                    const url = event.target.value;
                    // 粘进来的 URL 能认出平台就自动切，省一次手动选择；认不出保留手选的。
                    patch(row.id, { url, provider: detectImProvider(url) });
                  }}
                />
              </span>
            </div>
            {needsImSecret(row.provider) && (
              <div className="pw-field">
                <span className="pw-label">
                  {t("imBridge.secret")}
                  <small>{t("imBridge.secretHint")}</small>
                </span>
                <span className="pw-ctl">
                  <input
                    className="pw-input pw-mono"
                    type="password"
                    autoComplete="off"
                    value={row.secret}
                    placeholder="SEC…"
                    onChange={(event) => patch(row.id, { secret: event.target.value })}
                  />
                </span>
              </div>
            )}
            {needsImChatId(row.provider) && (
              <div className="pw-field">
                <span className="pw-label">{t("imBridge.chatId")}</span>
                <span className="pw-ctl">
                  <input
                    className="pw-input pw-mono"
                    value={row.chatId}
                    placeholder="-100…"
                    onChange={(event) => patch(row.id, { chatId: event.target.value })}
                  />
                </span>
              </div>
            )}
            <div className="pw-field">
              <span className="pw-label">{t("imBridge.enabled")}</span>
              <span className="pw-ctl">
                <ConfigSwitch
                  checked={row.enabled}
                  label={row.label || PROVIDER_LABELS[row.provider]}
                  onChange={(checked) => patch(row.id, { enabled: checked })}
                />
              </span>
            </div>
            <div className="pw-field">
              <span className="pw-label">{t("imBridge.actions")}</span>
              <span className="pw-ctl">
                <ConfigButton
                  size="small"
                  disabled={busy !== null}
                  onClick={() => void test(row)}
                >
                  <span className="pw-ico"><i data-ico="send" data-size="13" aria-hidden="true" /></span>
                  {t("imBridge.test")}
                </ConfigButton>
                <ConfigButton
                  variant="danger"
                  size="small"
                  disabled={busy !== null}
                  onClick={() => {
                    const next = rows.filter((entry) => entry.id !== row.id);
                    setRows(next);
                    void save(next);
                  }}
                >
                  <span className="pw-ico"><i data-ico="trash-2" data-size="13" aria-hidden="true" /></span>
                  {t("imBridge.remove")}
                </ConfigButton>
              </span>
            </div>
          </div>
        ))}
        <ConfigListAction onClick={() => setRows((current) => [...current, emptyRow()])}>
          {t("imBridge.add")}
        </ConfigListAction>
      </div>

      <div className="pw-row" style={{ gap: "var(--s2)", cursor: "default" }}>
        <span className="grow" />
        <ConfigButton
          size="small"
          disabled={busy !== null || !loaded}
          onClick={() => void save(rows)}
        >
          <span className="pw-ico"><i data-ico="check" data-size="13" aria-hidden="true" /></span>
          {t("imBridge.save")}
        </ConfigButton>
      </div>

      <p className="sub">{t("imBridge.outboundOnly")}</p>
    </div>
  );
}
