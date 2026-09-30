"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

/**
 * fork:design-system SW-16 —— 画板 60 帧 B 的分平台安装提示（移动端）：
 *
 * - Android / 桌面 Chrome：捕获 `beforeinstallprompt`，横幅里给「安装」钮
 *   （调 `prompt()`，选择结果不关心——装没装下一轮 standalone 判定自然分流）；
 * - iOS Safari：不派发该事件，改教「分享 → 添加到主屏幕」（share-2 图标）；
 * - 已在 standalone 独立窗口里：什么都不显示；
 * - 关闭钮写 localStorage，本次安装不再出现。
 *
 * 视觉是画板的 `.pw-banner`（download / share-2 图标 + grow 文案 + primary sm 钮
 * + 关闭 iconbtn）。桌面端不画（画板 60 是移动端基准，桌面安装走浏览器自带入口）。
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "pi-install-prompt-dismissed";

export function InstallPromptBanner() {
  const { t } = useI18n();
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

  return (
    <div className="pw-banner" data-install-banner="true">
      {deferred ? (
        <>
          <span className="pw-ico" style={{ color: "var(--accent-text)" }}>
            <i data-ico="download" data-size="16" aria-hidden="true" />
          </span>
          <span className="grow">{t("install.bannerBody")}</span>
          <button type="button" className="pw-btn primary sm" onClick={() => void install()}>
            {t("install.installButton")}
          </button>
        </>
      ) : (
        <>
          <span className="pw-ico" style={{ color: "var(--accent-text)" }}>
            <i data-ico="share-2" data-size="16" aria-hidden="true" />
          </span>
          <span className="grow">{t("install.iosBody")}</span>
        </>
      )}
      <button type="button" className="pw-iconbtn sm" aria-label={t("i18n.close")} title={t("i18n.close")} onClick={dismiss}>
        <span className="pw-ico"><i data-ico="x" data-size="14" aria-hidden="true" /></span>
      </button>
    </div>
  );
}
