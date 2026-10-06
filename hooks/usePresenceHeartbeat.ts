"use client";

import { useEffect, useRef } from "react";

/**
 * fork:mobile-shell —— 在场心跳（客户端侧）。
 *
 * 每 10 秒向 `/api/presence/heartbeat` 报一拍，服务端据此裁决 Web Push 发不发。
 * 关键语义：上报的是 `lastActivityAtMs`（用户最近一次交互），不是「标签页活着」——
 * 桌面 Chrome 常驻在线不该让手机永远哑掉；人离开电脑后交互时间变陈旧，
 * 180 秒后判定为离场，推送恢复。
 *
 * - clientId 放 sessionStorage：一个标签页一个身份，关掉即消失。
 * - visibilitychange / focus / online 时立即补一拍（不用等下一个 10s 周期）。
 * - pagehide 用 keepalive 送最后一拍，把 appVisible=false 尽快报上去。
 * - 后台标签页的定时器会被浏览器节流到 ≥1 次/分钟，仍远短于 180s 判定窗；
 *   移动端锁屏挂起后 JS 整个停摆、心跳停止 → 自动离场 → 推送能送达。这正是想要的。
 */

const CLIENT_ID_KEY = "pi-web:presence-client-id";
const BEAT_INTERVAL_MS = 10_000;

export function usePresenceHeartbeat(focusedSessionId: string | null): void {
  const focusedRef = useRef(focusedSessionId);
  focusedRef.current = focusedSessionId;

  useEffect(() => {
    let clientId = "";
    try {
      clientId = sessionStorage.getItem(CLIENT_ID_KEY) ?? "";
      if (!clientId) {
        clientId = typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        sessionStorage.setItem(CLIENT_ID_KEY, clientId);
      }
    } catch {
      // sessionStorage 可能被禁用；身份退化成一次性的，语义不变。
      clientId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }

    let lastActivityAtMs: number | null = document.visibilityState === "visible" ? Date.now() : null;
    const markActivity = () => {
      lastActivityAtMs = Date.now();
    };
    // 交互探针都是低频事件（pointerdown/keydown/wheel/touchstart），不做节流。
    window.addEventListener("pointerdown", markActivity, { passive: true });
    window.addEventListener("keydown", markActivity);
    window.addEventListener("wheel", markActivity, { passive: true });
    window.addEventListener("touchstart", markActivity, { passive: true });
    const onVisible = () => {
      if (document.visibilityState === "visible") markActivity();
    };
    document.addEventListener("visibilitychange", onVisible);

    let cancelled = false;
    const beat = (keepalive = false) => {
      if (cancelled) return;
      void fetch("/api/presence/heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        keepalive,
        body: JSON.stringify({
          clientId,
          appVisible: document.visibilityState === "visible",
          focusedSessionId: focusedRef.current,
          lastActivityAtMs,
        }),
      }).catch(() => {
        // 心跳尽力而为：离线时静默，服务端按陈旧判定。
      });
    };
    const onPageHide = () => beat(true);

    const interval = window.setInterval(() => beat(), BEAT_INTERVAL_MS);
    document.addEventListener("visibilitychange", onPageHideVisibleBeat);
    window.addEventListener("focus", onPageHideVisibleBeat);
    window.addEventListener("online", onPageHideVisibleBeat);
    window.addEventListener("pagehide", onPageHide);
    beat();

    function onPageHideVisibleBeat() {
      if (document.visibilityState === "visible") markActivity();
      beat();
    }

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("pointerdown", markActivity);
      window.removeEventListener("keydown", markActivity);
      window.removeEventListener("wheel", markActivity);
      window.removeEventListener("touchstart", markActivity);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("visibilitychange", onPageHideVisibleBeat);
      window.removeEventListener("focus", onPageHideVisibleBeat);
      window.removeEventListener("online", onPageHideVisibleBeat);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);
}
