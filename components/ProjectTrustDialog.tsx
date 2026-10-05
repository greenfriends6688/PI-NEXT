"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { formatDuration } from "./MessageView";
import { PwaTrustSheet } from "./pwa/PwaTrustSheet";

/**
 * fork:design-components —— 项目信任对话框 = 画板 D-26b 帧 E「项目信任对话框」：
 * 三个状态是**同一个模态的三种头部图标**（shield-question / loader-circle / circle-x），
 * 壳是 `.d-modal.is-open` › `.d-modal-box` › `.d-modal-head` + `.d-modal-body` +
 * `.d-modal-foot`；正文里的 cwd 走 `.d-code`（图标 + mono path）。
 *
 * fork:v5-wave-b-sysstate —— 窄屏（`useIsMobile()`）走 M-10 帧 C-2 的
 * `.m-scrim.is-open` + `.m-sheet.is-open` 底部 sheet，DOM 在
 * `components/pwa/PwaTrustSheet.tsx`。三态与两枚动作的 props 不变。
 *
 * fork:v5-wave-n1 —— 补 D-26 帧 D「信任状态出现在哪」那颗 **信任状态胶囊**：
 * `<div class="d-row"><span class="d-extpill untrusted"><span class="d-extpill-dot"></span>
 * 未信任 · ~/Desktop/PI NEXT</span></div>`。类名 / 嵌套照画板原文。
 * 两处有意的偏差，都记在这里：
 *   ① 文案用**既有** key `trust.resourcesNotLoaded`（产品里它表示的正是
 *      「项目资源还没加载 = 受限模式」），不硬编中文、不新增 key；
 *   ② 画板那行是「未信任 · 路径」，但画板自己的注记写明这颗胶囊的位置是
 *      **顶栏的工作区胶囊**（「随时能改主意，也能随时撤销信任」），不是模态里；
 *      顶栏宿主不在本波文件清单里，而模态正下方 `.d-code` 已经写着同一个 cwd，
 *      所以这里只留状态词，不再把路径写第二遍。
 * 为什么这个对话框里出现它是如实的：这个模态**只在项目未受信任时**弹出，
 * 所以「未信任」不是推测，是它此刻唯一可能的状态。
 */
export function ProjectTrustDialog({
  cwd,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  cwd: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  /* fork:v5-frame-audit · D-26b 帧 E「进行中」那一态：等待中不给「取消」，只给
     思考点阵 + 秒表。秒表数的是**真实经过的时间**（busy 翻 true 的那一刻起表），
     不是写死的百分比 —— 画板上那个 46% 是样例，产品不给一个假的进度。 */
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  if (isMobile) {
    return <PwaTrustSheet cwd={cwd} busy={busy} error={error} onCancel={onCancel} onConfirm={onConfirm} />;
  }

  const headIcon = error
    ? { ico: "circle-x", color: "var(--nx-danger)" }
    : busy
      ? { ico: "loader-circle", color: "var(--nx-accent)" }
      : { ico: "shield-question", color: "var(--nx-warning)" };

  return (
    <div
      role="presentation"
      // fork:ui-10 — hook for the phone bottom-sheet geometry in app/fork-ui.css
      data-fork-dialog="trust"
      className="d-modal is-open"
      onClick={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-trust-title"
        className="d-modal-box"
        style={{ width: 440, maxWidth: "100%" }}
      >
        <div className="d-modal-head">
          <i data-ico={headIcon.ico} data-size="16" aria-hidden="true" style={{ color: headIcon.color, marginRight: "var(--nx-sp-2)" }} />
          <span id="project-trust-title">{t("trust.dialogTitle")}</span>
        </div>
        <div className="d-modal-body">
          <div>{t("trust.dialogBody")}</div>
          {/* fork:v5-wave-n1 · D-26 帧 D「信任状态出现在哪」—— 状态胶囊。
              画板原文两段：`.d-row` 包一颗 `.d-extpill.untrusted`，pill 首位是
              `.d-extpill-dot`。未受信任 = warning 色的点（system.css 里
              `.d-extpill.untrusted .d-extpill-dot` 已经把点改成 warning）。 */}
          <div className="d-row">
            <span className="d-extpill untrusted">
              <span className="d-extpill-dot" />
              {t("trust.resourcesNotLoaded")}
            </span>
          </div>
          <div className="d-code">
            <div className="d-code-head">
              <i data-ico="folder" data-size="13" aria-hidden="true" />
              <span className="d-grow d-mono">{cwd}</span>
            </div>
          </div>
          {error && (
            <div className="d-err" role="alert">
              <span className="d-mono">{error}</span>
            </div>
          )}
        </div>
        <div className="d-modal-foot">
          {busy ? (
            /* 画板「进行中」那一态：不给「取消」（写一半的信任记录比没有更糟），
               只留思考点阵 + 秒表。 */
            <>
              <span className="d-grow" />
              <span className="d-think-dots wave" aria-hidden="true">
                <i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>
              </span>
              <span className="d-think-timer d-t-xs">{formatDuration(elapsed)}</span>
            </>
          ) : (
            <>
              <button type="button" className="d-btn ghost d-pressable" onClick={onCancel}>
                {t("trust.cancel")}
              </button>
              <span className="d-grow" />
              <button type="button" className="d-btn primary d-pressable" onClick={onConfirm}>
                <i data-ico="shield-check" data-size="14" aria-hidden="true" />
                {t("trust.trustProject")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
