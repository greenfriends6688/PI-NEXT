"use client";

import { Fragment, useCallback, useEffect, useState } from "react";

import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { PwaBanner, PwaPickSelect, PwaSetRow, PwaSwitchRow } from "@/components/pwa/PwaPage";
// fork:client-graph-purity —— 只能 import `-shared` 那半边：实现留服务端
// （`lib/im-bridge.ts` 要 node:fs / pi SDK，拖进客户端图会让 build 红）。
import {
  IM_PROVIDER_IDS,
  detectImProvider,
  needsImChatId,
  needsImSecret,
  type ImProvider,
} from "@/lib/im-bridge-shared";
import { PwSwitch } from "../SettingsUi";

/**
 * fork:im-bridge —— IM 群机器人目标的管理页。
 *
 * 全部用 v5 画板已有原子（`.d-card` / `.d-field` / `.d-input` / `.d-select` /
 * `.d-banner` / `.d-set-row`），不新增 `d-*` 类；窄屏另取 `.m-*`（见函数体内注释）。
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
  const mobile = useIsMobile();
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

  // fork:v5-landing Wave B · M-10 · 窄屏：一条目标 = 一张 `.m-cardgroup`
  // （标签行 + `.m-doc-body` 控件槽 + 末尾开关行 + 动作 pickbar）。
  // **掩码口径一字不改**：URL / secret 仍是 `type="password"`，
  // 服务器回传仍然只给 host，已保存的那条仍然显示「已保存」。
  if (mobile) {
    return (
      <>
        {error && <PwaBanner icon="circle-x" tone="err" role="alert">{error}</PwaBanner>}
        {status && !error && <PwaBanner icon="circle-check" role="status">{status}</PwaBanner>}

        {rows.map((row) => (
          <div className="m-cardgroup" key={row.id}>
            <PwaSetRow label={t("imBridge.name")} />
            <div className="m-doc-body">
              <input
                className="m-input"
                style={{ width: "100%" }}
                value={row.label}
                placeholder={PROVIDER_LABELS[row.provider]}
                onChange={(event) => patch(row.id, { label: event.target.value })}
              />
            </div>

            <PwaSetRow label={t("imBridge.platform")} sub={PROVIDER_HINTS[row.provider]} />
            <div className="m-doc-body">
              {/* fork:v5-landing · M-05 帧 B —— 设置里的「从若干值里选一个」用
                  `.m-pickselect`（下拉交给系统），不再拿 `.m-input` 套原生 select。
                  掩码口径、平台自动识别与写盘全部一字不改。 */}
              <PwaPickSelect
                value={row.provider}
                ariaLabel={t("imBridge.platform")}
                options={IM_PROVIDER_IDS.map((provider) => ({ value: provider, label: PROVIDER_LABELS[provider] }))}
                onChange={(value) => patch(row.id, { provider: value as ImProvider })}
              />
            </div>

            <PwaSetRow label={t("imBridge.url")} />
            <div className="m-doc-body">
              <input
                className="m-input m-mono"
                style={{ width: "100%" }}
                type="password"
                autoComplete="off"
                value={row.url}
                placeholder={row.url ? "••••••（已保存）" : "https://…"}
                onChange={(event) => {
                  const url = event.target.value;
                  patch(row.id, { url, provider: detectImProvider(url) });
                }}
              />
            </div>

            {needsImSecret(row.provider) && (
              <Fragment>
                <PwaSetRow label={t("imBridge.secret")} sub={t("imBridge.secretHint")} />
                <div className="m-doc-body">
                  <input
                    className="m-input m-mono"
                    style={{ width: "100%" }}
                    type="password"
                    autoComplete="off"
                    value={row.secret}
                    placeholder="SEC…"
                    onChange={(event) => patch(row.id, { secret: event.target.value })}
                  />
                </div>
              </Fragment>
            )}
            {needsImChatId(row.provider) && (
              <Fragment>
                <PwaSetRow label={t("imBridge.chatId")} />
                <div className="m-doc-body">
                  <input
                    className="m-input m-mono"
                    style={{ width: "100%" }}
                    value={row.chatId}
                    placeholder="-100…"
                    onChange={(event) => patch(row.id, { chatId: event.target.value })}
                  />
                </div>
              </Fragment>
            )}

            <PwaSwitchRow
              label={t("imBridge.enabled")}
              sub={row.label || PROVIDER_LABELS[row.provider]}
              checked={row.enabled}
              switchLabel={row.label || PROVIDER_LABELS[row.provider]}
              onChange={(checked) => patch(row.id, { enabled: checked })}
            />

            <div className="m-pickbar">
              <button type="button" className="m-picktag" disabled={busy !== null} onClick={() => void test(row)}>
                <i data-ico="send" data-size="13" aria-hidden="true" />
                {t("imBridge.test")}
              </button>
              <button
                type="button"
                className="m-picktag danger"
                disabled={busy !== null}
                onClick={() => {
                  const next = rows.filter((entry) => entry.id !== row.id);
                  setRows(next);
                  void save(next);
                }}
              >
                <i data-ico="trash-2" data-size="13" aria-hidden="true" />
                {t("imBridge.remove")}
              </button>
            </div>
          </div>
        ))}

        <button
          type="button"
          className="m-btn"
          onClick={() => setRows((current) => [...current, emptyRow()])}
        >
          <i data-ico="plus" data-size="13" aria-hidden="true" />
          {t("imBridge.add")}
        </button>

        <div className="m-pickbar">
          <button
            type="button"
            className="m-picktag is-on"
            disabled={busy !== null || !loaded}
            onClick={() => void save(rows)}
          >
            <i data-ico="check" data-size="13" aria-hidden="true" />
            {t("imBridge.save")}
          </button>
        </div>
        <p className="m-t-xs m-t-faint">{t("imBridge.outboundOnly")}</p>
      </>
    );
  }

  return (
    <div className="d-col" style={{ gap: "var(--nx-sp-3)" }}>
      {error && (
        <div className="d-banner err" role="alert">
          <i data-ico="circle-x" data-size="14" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
      {status && !error && (
        <div className="d-banner info" role="status">
          <i data-ico="circle-check" data-size="14" aria-hidden="true" />
          <span>{status}</span>
        </div>
      )}

      <div className="d-col" style={{ gap: "var(--nx-sp-2)" }}>
        {rows.map((row) => (
          <div key={row.id} className="d-card">
            <div className="d-card-body d-col" style={{ gap: "var(--nx-sp-2)" }}>
            <div className="d-field">
              <span className="d-field-t">{t("imBridge.name")}</span>
              <input
                className="d-input"
                value={row.label}
                placeholder={PROVIDER_LABELS[row.provider]}
                onChange={(event) => patch(row.id, { label: event.target.value })}
              />
            </div>
            <div className="d-field">
              <span className="d-field-t">{t("imBridge.webhook")}</span>
              <select
                className="d-select"
                value={row.provider}
                aria-label={t("imBridge.platform")}
                onChange={(event) => patch(row.id, { provider: event.target.value as ImProvider })}
              >
                {IM_PROVIDER_IDS.map((provider) => (
                  <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>
                ))}
              </select>
              <span className="d-t-xs d-t-faint">{PROVIDER_HINTS[row.provider]}</span>
            </div>
            <div className="d-field">
              <span className="d-field-t">{t("imBridge.url")}</span>
              <input
                className="d-input d-mono"
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
            </div>
            {needsImSecret(row.provider) && (
              <div className="d-field">
                <span className="d-field-t">{t("imBridge.secret")}</span>
                <input
                  className="d-input d-mono"
                  type="password"
                  autoComplete="off"
                  value={row.secret}
                  placeholder="SEC…"
                  onChange={(event) => patch(row.id, { secret: event.target.value })}
                />
                <span className="d-t-xs d-t-faint">{t("imBridge.secretHint")}</span>
              </div>
            )}
            {needsImChatId(row.provider) && (
              <div className="d-field">
                <span className="d-field-t">{t("imBridge.chatId")}</span>
                <input
                  className="d-input d-mono"
                  value={row.chatId}
                  placeholder="-100…"
                  onChange={(event) => patch(row.id, { chatId: event.target.value })}
                />
              </div>
            )}
            <div className="d-set-row">
              <div className="d-set-row-box">
                <div className="d-set-row-t">{t("imBridge.enabled")}</div>
              </div>
              <span className="d-grow-last">
                <PwSwitch
                  checked={row.enabled}
                  label={row.label || PROVIDER_LABELS[row.provider]}
                  onChange={(checked) => patch(row.id, { enabled: checked })}
                />
              </span>
            </div>
            <div className="d-row" style={{ justifyContent: "flex-end", gap: "var(--nx-sp-2)" }}>
              <button
                type="button"
                className="d-btn sm"
                disabled={busy !== null}
                onClick={() => void test(row)}
              >
                <i data-ico="send" data-size="13" aria-hidden="true" />
                {t("imBridge.test")}
              </button>
              <button
                type="button"
                className="d-btn sm danger ghost"
                disabled={busy !== null}
                onClick={() => {
                  const next = rows.filter((entry) => entry.id !== row.id);
                  setRows(next);
                  void save(next);
                }}
              >
                <i data-ico="trash-2" data-size="13" aria-hidden="true" />
                {t("imBridge.remove")}
              </button>
            </div>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="d-btn ghost"
          onClick={() => setRows((current) => [...current, emptyRow()])}
        >
          <i data-ico="plus" data-size="13" aria-hidden="true" />
          {t("imBridge.add")}
        </button>
      </div>

      <div className="d-row" style={{ justifyContent: "flex-end" }}>
        <button
          type="button"
          className="d-btn sm"
          disabled={busy !== null || !loaded}
          onClick={() => void save(rows)}
        >
          <i data-ico="check" data-size="13" aria-hidden="true" />
          {t("imBridge.save")}
        </button>
      </div>

      <p className="d-t-xs d-t-faint">{t("imBridge.outboundOnly")}</p>
    </div>
  );
}
