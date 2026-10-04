"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";

/**
 * fork:design-system SW-16 —— 画板 60 帧 B 的分平台安装提示（移动端）：
 *
 * - Android / 桌面 Chrome：捕获 `beforeinstallprompt`，横幅里给「安装」钮
 *   （调 `prompt()`，选择结果不关心——装没装下一轮 standalone 判定自然分流）；
 * - iOS Safari：不派发该事件，改教「分享 → 添加到主屏幕」（share-2 图标）；
 * - 已在 standalone 独立窗口里：什么都不显示；
 * - 关闭钮写 localStorage，本次安装不再出现。
 *
 * 视觉是 v5 画板 D-26 帧 C 的 `.d-banner`（download / share-2 图标 + `.d-grow` 文案
 * + `.d-btn sm .d-banner-btn` 行动钮 + `.d-iconbtn` 关闭）。桌面端不画（画板 60 / M-10
 * 是移动端基准，桌面安装走浏览器自带入口）。
 *
 * fork:v5-wave-b-sysstate —— 窄屏（`useIsMobile()`，这个组件本来就只在手机
 * 挂载）走 M-10 的横幅形态 `.m-banner`：两枚按钮都补 `.m-touch-44`
 * （M-11 帧 C：44 是硬下限）。**分平台的分工不变**：握到
 * `beforeinstallprompt` 的一条主按钮（下载图标），iOS 一条「分享 →
 * 添加到主屏幕」的人话（share-2 图标），桌面入口不写进来
 * （M-10 帧 A-3 的原话：「手机上的这条提示里不放桌面平台」）。
 *
 * M-10 的 iOS 三步 / Android 条件自检需要新文案（`install.steps.*`）与真实
 * 数据（体积 / 缓存 / HTTPS 自检），i18n 波未提供前不硬编中文，本波不造。
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "pi-install-prompt-dismissed";

export function InstallPromptBanner() {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIos, setShowIos] = useState(false);
  // SSR 首帧先隐藏，effect 里再放开——横幅依赖 window 判定，服务端渲染不出内容。
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) return;
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      // localStorage 不可用（隐私模式）就不记住关闭，横幅每次会话出现一次。
    }

    const onPrompt = (event: Event) => {
      // 阻止 Chrome 自己的 mini-infobar：画板的横幅替代它。
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // iPadOS 13+ 的 Safari 默认报 Macintosh UA，这里按 iPhone/iPod 教学（主流场景）。
    const isIos = /iphone|ipod/i.test(navigator.userAgent);
    if (isIos) setShowIos(true);

    setHidden(false);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const dismiss = useCallback(() => {
    setHidden(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // 忽略：不可持久化就只在本次会话内隐藏。
    }
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } finally {
      setDeferred(null);
      dismiss();
    }
  }, [deferred, dismiss]);

  if (hidden || (!deferred && !showIos)) return null;

  if (isMobile) {
    /* M-10 帧 A 的横幅面：`.m-banner` + 图标 + `.m-grow` 文案 +
       一枚 `.m-btn.sm.m-touch-44` 行动钮 + `.m-iconbtn.m-touch-44` 关闭。 */
    return (
      <div className="m-banner" data-install-banner="true">
        {deferred ? (
          <>
            <i data-ico="download" data-size="16" aria-hidden="true" />
            <span className="m-grow">{t("install.bannerBody")}</span>
            <button type="button" className="m-btn sm m-touch-44" onClick={() => void install()}>
              {t("install.installButton")}
            </button>
          </>
        ) : (
          <>
            <i data-ico="share-2" data-size="16" aria-hidden="true" />
            <span className="m-grow">{t("install.iosBody")}</span>
          </>
        )}
        <button type="button" className="m-iconbtn m-touch-44" aria-label={t("i18n.close")} title={t("i18n.close")} onClick={dismiss}>
          <i data-ico="x" data-size="14" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    /* 画板 D-26 帧 C「横幅」：`.d-banner` + `.d-grow` 文案 + 一枚行动钮
       （`.d-btn sm .d-banner-btn`）+ `.d-iconbtn` 关闭。 */
    <div className="d-banner" data-install-banner="true">
      {deferred ? (
        <>
          <i data-ico="download" data-size="16" aria-hidden="true" />
          <span className="d-grow">{t("install.bannerBody")}</span>
          <button type="button" className="d-btn sm d-banner-btn" onClick={() => void install()}>
            {t("install.installButton")}
          </button>
        </>
      ) : (
        <>
          <i data-ico="share-2" data-size="16" aria-hidden="true" />
          <span className="d-grow">{t("install.iosBody")}</span>
        </>
      )}
      <button type="button" className="d-iconbtn" aria-label={t("i18n.close")} title={t("i18n.close")} onClick={dismiss}>
        <i data-ico="x" data-size="14" aria-hidden="true" />
      </button>
    </div>
  );
}
