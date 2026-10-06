"use client";

import { useEffect } from "react";

import { isMobileShell } from "@/lib/mobile-shell";

/**
 * fork:sw-version-guard（2026-10-06）—— service worker 的**版本自愈**。
 *
 * 为什么需要它：手机上「改了没生效」反复出现，机制是这个 ——
 *   · SW 的导航策略是 network-first，**网络一失败就回落到 SHELL_CACHE 里的旧 shell**；
 *   · 局域网这条路（`192.168.1.4:30141`）无 cookie 时返回 **401**（PI_WEB_LAN_TOKEN），
 *     cookie 过期或握手抖动都会让那一次导航拿不到 200；
 *   · 于是旧界面被端出来，而旧 SW 自己的 `CACHE_VERSION` 是写死的老值，
 *     它不会主动轮换 —— 用户刷一百次都还是那一份。
 *
 * 只靠「把 ?v= 改对」不够：改的是**新** SW 的缓存键，控制页面的仍是**旧** SW。
 * 所以要在页面侧做一次自检：缓存里那些 `pi-web-*` 桶，有没有一个是**当前构建**的？
 * 没有就说明手上是旧的 → 清桶 + 注销 + 重载一次。
 *
 * 只重载一次（`sessionStorage` 打标），否则构建期版本一变就会来回刷屏。
 * 只在生产生效；开发环境本来就不注册 SW（见下面第一个 return）。
 */
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
const CACHE_PREFIX = "pi-web-";
const RELOAD_FLAG = "pi-web:sw-reload-for";

export function PwaRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) {
      return;
    }

    /* fork:mobile-shell —— 壳内禁用 SW。
       原生 App 里没有离线价值：SW 的 network-first 回落只会造成「改了代码壳里还是
       旧的」这类最难查的 bug（本文件顶部那段自愈逻辑治的就是它的网页版）。壳里不仅
       不注册，还把壳之前可能注册过的残留清掉；这是壳化的第一守卫，必须在 register
       之前短路。 */
    if (isMobileShell()) {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(registrations.map((registration) => registration.unregister().catch(() => false))),
        )
        .catch(() => {
          // 尽力而为：清不掉也不阻塞壳内使用。
        });
      return;
    }

    /* 自检：手上这套缓存是不是当前构建的？
       缓存名形如 `pi-web-static-<version>` / `pi-web-shell-<version>`，
       `<version>` 就是 SW 从 `?v=` 读到的那个串（现在是 包版本+源码指纹+构建时刻）。 */
    const healStaleCache = async () => {
      if (!("caches" in window)) return;
      let names: string[];
      try {
        names = await caches.keys();
      } catch {
        return;
      }
      const ours = names.filter((name) => name.startsWith(CACHE_PREFIX));
      if (ours.length === 0) return; // 还没装过 SW：交给下面的 register 装新的
      const current = ours.some((name) => name.endsWith(APP_VERSION));
      if (current) return;
      // 只自愈一次，避免构建期版本来回变导致反复重载。
      try {
        if (sessionStorage.getItem(RELOAD_FLAG) === APP_VERSION) return;
        sessionStorage.setItem(RELOAD_FLAG, APP_VERSION);
      } catch {
        // 存储不可用（隐私模式）时退化为「本次运行只自愈一次」。
      }
      await Promise.all(ours.map((name) => caches.delete(name).catch(() => false)));
      const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
      await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)));
      window.location.reload();
    };

    const register = () => {
      void healStaleCache().then(() => {
        const scriptUrl = `/sw.js?v=${encodeURIComponent(APP_VERSION)}`;
        return navigator.serviceWorker.register(scriptUrl, {
          scope: "/",
          updateViaCache: "none",
        });
      }).catch((error: unknown) => {
        console.error("Failed to register the PI NEXT service worker:", error);
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
