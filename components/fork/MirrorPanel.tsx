"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { useI18n } from "@/hooks/useI18n";
import {
  getMobileSyncState,
  openMirrorLibrary,
  runMobileSync,
  subscribeMobileSyncState,
} from "@/lib/mobile-sync";
import { isMobileShell } from "@/lib/mobile-shell";

/**
 * fork:mobile-shell —— 壳内镜像库入口卡（手机与推送分节里，**只在壳里渲染**）。
 *
 * 排版复用 v5 画板已有原子（`.m-card` / `.m-setrow-t|s` / `.m-tray` / `.m-tray-chip`），
 * 不新增任何类。同步引擎与状态见 `lib/mobile-sync.ts`。
 */
export function MirrorBody() {
  const { t, locale } = useI18n();
  const state = useSyncExternalStore(subscribeMobileSyncState, getMobileSyncState);
  const [inShell, setInShell] = useState(false);

  useEffect(() => {
    setInShell(isMobileShell());
  }, []);

  if (!inShell) return null;

  const statusText = state.running
    ? t("phonePush.mirrorRunning")
    : state.lastError
      ? `${t("phonePush.mirrorErr")}：${state.lastError}`
      : state.lastSyncAt
        ? `${t("phonePush.mirrorLastAt")} ${new Date(state.lastSyncAt).toLocaleTimeString(locale === "zh-CN" ? "zh-CN" : undefined, { hour: "2-digit", minute: "2-digit" })}${state.lastSummary ? ` · +${state.lastSummary.updated}` : ""}`
        : t("phonePush.mirrorIdle");

  return (
    <div className="m-card">
      <div className="m-card-head">
        <span className="m-setrow-t">{t("phonePush.mirrorTitle")}</span>
        <span className="m-grow" aria-hidden="true" />
      </div>
      <div className="m-setrow-s">{t("phonePush.mirrorHint")}</div>
      <div className="m-setrow-s" style={{ marginTop: "var(--nx-sp-2)" }}>{statusText}</div>
      <div className="m-tray">
        <button
          type="button"
          className="m-tray-chip"
          disabled={state.running}
          onClick={() => void runMobileSync()}
        >
          <i data-ico="refresh-cw" data-size="12" aria-hidden="true" />
          {t("phonePush.mirrorSync")}
        </button>
        <button type="button" className="m-tray-chip" onClick={openMirrorLibrary}>
          <i data-ico="book-open" data-size="12" aria-hidden="true" />
          {t("phonePush.mirrorOpen")}
        </button>
      </div>
    </div>
  );
}
