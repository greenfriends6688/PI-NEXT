"use client";

import { useI18n } from "@/hooks/useI18n";
import { retryNoticeMessageKey, type RetryNotice as RetryNoticeModel, type RetryPhase } from "@/lib/retry-policy";
// fork:v5-wave-b —— PWA 形态：`.d-banner` 三态换成画板 M-02 帧 C 的 `.m-banner`
// （同样的 warn / 默认 / err 语气档），状态图标仍走 `<i data-ico>`。
import { usePwaSkin } from "@/components/pwa/skin";

/**
 * fork:proma-35-retry —— 消息流里的一枚轻量重试提示（PR-35）。
 *
 * 它不是一条 assistant 消息，也不写进转录：只是一行「第 N/M 次继续当前回答」，
 * 让「卡住了」变成「正在第几次恢复」。数据全部来自 `lib/retry-policy.ts`，
 * 这里只负责画。
 *
 * - **只画已经过阈值的事件**：`mapRetryEvent` 在 `attempt <= 5` 时返回 `null`，
 *   所以前五次网络抖动不会出现在这里（降噪）。
 * - **终态不重复**：`upsertRetryNotice` 按 attempt 覆盖，同一第 N 次只会有一行。
 * - 数字用 `tabular-nums`：否则「第 3 次」变「第 10 次」时整行宽度会跳。
 * - 壳是画板已有的 `.d-banner` + `warn / 默认 / err` 语气档（画板 D-03e 帧 D；
 *   窄屏是 M-02 帧 C 的 `.m-banner` 同一组语气档），图标走 lucide 的
 *   `<i data-ico>`；只新增一个 `fork-retry-notices` 布局钩子。
 */

const PHASE_ICON: Record<RetryPhase, string> = {
  scheduled: "refresh-cw",
  running: "refresh-cw",
  succeeded: "circle-check",
  exhausted: "triangle-alert",
  cancelled: "ban",
};

/** 画板 D-03e 帧 D · 重试提示条：`d-banner` 三态（warn / 默认成功 / err）。
 *  fork:v5-wave-b —— 窄屏是 M-02 帧 C 的 `m-banner` 三态（语义档一一对应）。 */
const PHASE_BANNER: Record<RetryPhase, string> = {
  scheduled: "d-banner warn",
  running: "d-banner warn",
  succeeded: "d-banner",
  exhausted: "d-banner err",
  cancelled: "d-banner warn",
};

const PHASE_BANNER_PWA: Record<RetryPhase, string> = {
  scheduled: "m-banner warn",
  running: "m-banner warn",
  succeeded: "m-banner",
  exhausted: "m-banner err",
  cancelled: "m-banner warn",
};

const SPINNING_PHASES: ReadonlySet<RetryPhase> = new Set(["scheduled", "running"]);

export function RetryNotice({ notices }: { notices: readonly RetryNoticeModel[] }) {
  const { t } = useI18n();
  const isPwa = usePwaSkin();

  if (notices.length === 0) return null;

  return (
    <div className="fork-retry-notices" role="status" aria-live="polite">
      {notices.map((notice) => {
        const spinning = SPINNING_PHASES.has(notice.phase);
        const succeeded = notice.phase === "succeeded";
        return (
          <div
            key={`${notice.runId}-${notice.attempt}`}
            className={isPwa ? PHASE_BANNER_PWA[notice.phase] : PHASE_BANNER[notice.phase]}
            // `.d-banner` 在画板里是通栏；进消息流后改为贴内容宽度，别占满整行。
            style={{ width: "fit-content", maxWidth: "100%" }}
          >
            {spinning ? (
              <span className={isPwa ? "m-run" : "d-run"}>
                <i data-ico={PHASE_ICON[notice.phase]} data-size="14" aria-hidden="true"></i>
              </span>
            ) : succeeded ? (
              <span className={isPwa ? "m-badge ok" : "d-badge ok"}>
                <i data-ico="circle-check" data-size="12" aria-hidden="true"></i>
              </span>
            ) : (
              <i data-ico={PHASE_ICON[notice.phase]} data-size="14" aria-hidden="true"></i>
            )}
            <span className={isPwa ? "m-grow" : "d-grow"} style={{ fontVariantNumeric: "tabular-nums" }}>
              {/* fork:v5-landing —— 板面把「第 N 次」的 N 加粗（`正在第 <b>3</b>/5 次…`），
                  数字仍然是等宽的，所以第 3 次变第 10 次时整行宽度不跳。词条是插值好的
                  一整句，这里按 attempt 的字面位置切一刀把那一位挖出来。 */}
              {(() => {
                const attempt = String(notice.attempt);
                const full = t(retryNoticeMessageKey(notice.phase), {
                  attempt: notice.attempt,
                  max: notice.maxRetries > 0 ? notice.maxRetries : notice.attempt,
                });
                const at = full.indexOf(attempt);
                if (at < 0) return full;
                return (
                  <>
                    {full.slice(0, at)}
                    <b>{attempt}</b>
                    {full.slice(at + attempt.length)}
                  </>
                );
              })()}
            </span>
            {/* fork:v5-landing —— 错误码是**兄弟**一格（`d-t-xs d-t-faint`），不是主句里
                的一段：它是给人排查用的旁注，跟着主句一起被强调会把两者读成一件事。 */}
            {notice.errorMessage ? (
              <span className={isPwa ? "m-t-xs m-t-faint" : "d-t-xs d-t-faint"}>{notice.errorMessage}</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
