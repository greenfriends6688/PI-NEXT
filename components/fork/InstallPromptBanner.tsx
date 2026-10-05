"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { Locale } from "@/lib/i18n/types";

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
 *
 * fork:v5-wave-n1 · M-11 帧 C 的 **48 档**（`.m-touch-48` = `--nx-ctl-lg`）
 * 从 44 提到「一级行动钮」那一档：M-10 帧 A-2 的「装到桌面」在画板上就是
 * sheet 里唯一的 `.m-btn.primary`，它属于 48 档（发送钮 / 顶栏钮 / 一级行动钮），
 * 不是 44 档。关闭钮仍按 44（它是「出现频率最高」那一档里的图标钮）。
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "pi-install-prompt-dismissed";

/* ─────────────────────────────────────────────────────────────────────────
 * fork:v5-landing E4 —— M-10 帧 B 的两条生命周期横幅（`.m-offline` / `.m-update`）。
 *
 * 它们和安装横幅同属「全局宿主件」，所以在同一个文件里导出；画板 M-10 帧 B-2 的
 * 断网条与帧 B-1 的更新浮条各自只有一种状态，这里接的是**真的**那种状态：
 *   · `.m-offline` → `navigator.onLine` + online / offline 两个事件；
 *   · `.m-update`  → Service Worker 的 `controllerchange` / `installing`
 *     （本项目 `public/sw.js` 在 install 里 `skipWaiting()`、在 activate 里
 *     `clients.claim()`，所以「新版本已装好、等一次重载」的真实信号就是
 *     「本来有 controller，现在换了新的」—— 首装不会误报，那时 controller 为空）。
 *
 * 画板原文（M-10 帧 B-1 / B-2）：
 *   <div class="m-update"><i data-ico="download">…</i><span class="m-setrow-body">…</span>
 *     <button class="m-branch">稍后</button></div>
 *   <div class="m-offline"><div>已断网 · 只读本地</div><div>发送会排队，联网后自动续跑</div></div>
 *
 * 两处与帧面的差别，都写在这里（帧面是一张状态图，产品要能真的用）：
 *   ① 更新浮条多一枚 `.m-btn.primary`「立即重载」—— 帧面只画了「稍后」，而它自己的
 *      注记写着「浮条只有两条路：现在就装，或稍后」；一只「稍后」等于没有出口。
 *   ② 两条横幅在产品的顶栏（`.m-top`，绝对定位的渐隐层）**下方**落到流里 ——
 *      帧面把横幅画在屏幕最顶上（那两帧根本没有顶栏），而产品那里是抽屉钮；
 *      直接 `top: 0` 会把抽屉入口盖住。所以只把 `position` 摆回流内（几何摆放，
 *      LANDING 铁律四允许的内联项），底色 / 描边 / 内距 / 字号全由类给。
 *      收尾波可把这一条收成 CSS（见汇报的「需要 CSS」）。
 * ───────────────────────────────────────────────────────────────────────── */

type Copy = Record<Locale, string>;

function copyOf(table: Copy, locale: string): string {
  return table[locale as Locale] ?? table.en;
}

/* 这几句在语言包里没有键，而这一轮不允许改 `lib/i18n/messages/**`
   （与 `components/pwa/settingsHub.ts` 同一口径：窄屏专属文案走本地表）。 */
const OFFLINE_STATE: Copy = {
  en: "Offline · local only",
  "zh-CN": "已断网 · 只读本地",
  "zh-TW": "已斷網 · 只讀本機",
};
const OFFLINE_COST: Copy = {
  en: "Sends are queued and resume when you are back online",
  "zh-CN": "发送会排队，联网后自动续跑",
  "zh-TW": "送出會排隊，連線後自動續跑",
};
const UPDATE_READY_TITLE: Copy = {
  en: "A newer version is ready",
  "zh-CN": "新版本已就绪",
  "zh-TW": "新版本已就緒",
};
const UPDATE_READY_SUB: Copy = {
  en: "Reload to switch · drafts and this turn are kept",
  "zh-CN": "重载后生效 · 草稿与正在跑的这一轮都不丢",
  "zh-TW": "重新載入後生效 · 草稿與正在跑的这一輪都不丟",
};
const UPDATE_RELOAD: Copy = {
  en: "Reload now",
  "zh-CN": "立即重载",
  "zh-TW": "立即重新載入",
};
const UPDATE_LATER: Copy = {
  en: "Later",
  "zh-CN": "稍后",
  "zh-TW": "稍後",
};

/**
 * `.m-offline` —— M-10 帧 B-2 的断网条：第一行说状态，第二行说代价。
 *
 * 它只报告事实，不开新行为：发送进队列是队列面板（M-03 帧 D）早就有的语义，
 * 这里不假装自己会排队 —— 文案写的就是那一句。
 */
export function PwaOfflineBanner() {
  const { locale } = useI18n();
  // 首帧先按「在线」渲染：SSR / hydration 时 `navigator` 还不存在（与安装横幅同一口径）。
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(window.navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (online) return null;
  return (
    <div className="m-offline" role="status" data-offline-banner="true" style={{ position: "static" }}>
      <div>{copyOf(OFFLINE_STATE, locale)}</div>
      <div>{copyOf(OFFLINE_COST, locale)}</div>
    </div>
  );
}

/**
 * `.m-update` —— M-10 帧 B-1 的更新浮条。
 *
 * 「稍后」**不是**「关掉」（板面原话）：它只是这一次先不装 —— 状态活在本次会话里，
 * 重载 / 重新打开应用它就自己回来（就是板面「什么时候再提醒」的第一档
 * 「下次进入应用时」）。真正会永久生效的那个决定不在这条浮条上。
 */
export function PwaUpdateBanner() {
  const { locale } = useI18n();
  const [ready, setReady] = useState(false);
  const [deferred, setDeferred] = useState(false);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const container = navigator.serviceWorker;
    // 首装也会 claim 一次并触发 controllerchange —— 那不是更新，所以先记下开屏那一刻
    // 有没有 controller（没有 = 这一次是安装，不是替换）。
    const hadController = Boolean(container.controller);

    const markReady = () => setReady(true);
    const onControllerChange = () => {
      if (hadController) markReady();
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void container.getRegistration?.()
        .then((registration) => registration?.update())
        .catch(() => { /* 查更新是尽力而为，失败不影响使用。 */ });
    };

    container.addEventListener("controllerchange", onControllerChange);
    document.addEventListener("visibilitychange", onVisible);

    // 装完但还没接管的 worker（`waiting`）与正在装的 worker（`installing`）都是「有新版本」。
    const seen = new Set<ServiceWorker>();
    const onUpdateFound = (event: Event) => {
      const worker = (event.target as ServiceWorkerRegistration | null)?.installing;
      if (!worker || seen.has(worker)) return;
      seen.add(worker);
      markReady();
    };
    let found: ServiceWorkerRegistration | undefined;
    void container.getRegistration?.().then((registration) => {
      found = registration;
      if (!registration || !hadController) return;
      if (registration.installing || registration.waiting) markReady();
      registration.addEventListener("updatefound", onUpdateFound);
    }).catch(() => { /* 同上。 */ });

    return () => {
      container.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisible);
      found?.removeEventListener("updatefound", onUpdateFound);
    };
  }, []);

  if (!ready || deferred) return null;
  return (
    <div className="m-update" role="status" data-update-banner="true">
      <i data-ico="download" data-size="16" aria-hidden="true" />
      <span className="m-setrow-body">
        <span className="m-setrow-t">{copyOf(UPDATE_READY_TITLE, locale)}</span>
        <span className="m-setrow-s">{copyOf(UPDATE_READY_SUB, locale)}</span>
      </span>
      <button
        type="button"
        className="m-btn primary sm m-touch-44"
        disabled={reloading}
        onClick={() => {
          setReloading(true);
          window.location.reload();
        }}
      >
        {copyOf(UPDATE_RELOAD, locale)}
      </button>
      <button type="button" className="m-branch" onClick={() => setDeferred(true)}>
        {copyOf(UPDATE_LATER, locale)}
      </button>
    </div>
  );
}

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
            <button type="button" className="m-btn sm m-touch-48" onClick={() => void install()}>
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
       （`.d-btn sm .d-banner-btn`）+ `.d-iconbtn` 关闭。
       fork:v5-frame-audit —— 三颗可点件都挂 `.d-pressable`（D-28 帧 F 的按压反馈，
       库里的类，台账记为缺口；这里是真 `:active`，不是假动）。 */
    <div className="d-banner" data-install-banner="true">
      {deferred ? (
        <>
          <i data-ico="download" data-size="16" aria-hidden="true" />
          <span className="d-grow">{t("install.bannerBody")}</span>
          <button type="button" className="d-btn sm d-banner-btn d-pressable" onClick={() => void install()}>
            {t("install.installButton")}
          </button>
        </>
      ) : (
        <>
          <i data-ico="share-2" data-size="16" aria-hidden="true" />
          <span className="d-grow">{t("install.iosBody")}</span>
        </>
      )}
      <button type="button" className="d-iconbtn d-pressable" aria-label={t("i18n.close")} title={t("i18n.close")} onClick={dismiss}>
        <i data-ico="x" data-size="14" aria-hidden="true" />
      </button>
    </div>
  );
}
