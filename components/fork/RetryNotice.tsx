"use client";

import { useI18n } from "@/hooks/useI18n";
import { retryNoticeMessageKey, type RetryNotice as RetryNoticeModel, type RetryPhase } from "@/lib/retry-policy";

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
 * - 壳是画板已有的 `.pw-toast` + `warn/ok/bad` 语气档（TaskProgressOverlay 同款），
 *   图标走 lucide 的 `<i data-ico>`；只新增一个 `fork-retry-notices` 布局钩子。
 */

const PHASE_ICON: Record<RetryPhase, string> = {
  scheduled: "refresh-cw",
  running: "refresh-cw",
  succeeded: "circle-check",
  exhausted: "triangle-alert",
  cancelled: "ban",
};

const PHASE_TONE: Record<RetryPhase, string> = {
  scheduled: "warn",
  running: "warn",
  succeeded: "ok",
  exhausted: "bad",
  cancelled: "warn",
};

const SPINNING_PHASES: ReadonlySet<RetryPhase> = new Set(["scheduled", "running"]);

export function RetryNotice({ notices }: { notices: readonly RetryNoticeModel[] }) {
  const { t } = useI18n();

  if (notices.length === 0) return null;

  return (
    <div className="fork-retry-notices" role="status" aria-live="polite">
      {notices.map((notice) => {
        const spinning = SPINNING_PHASES.has(notice.phase);
        return (
          <div
            key={`${notice.runId}-${notice.attempt}`}
            className={`pw-toast ${PHASE_TONE[notice.phase]}`}
            // `.pw-toast` 在画板里是定宽浮条；进消息流后改为贴内容宽度，别占满整行。
            style={{ width: "fit-content", maxWidth: "100%" }}
          >
            <span className="pw-ico">
              <i
                data-ico={PHASE_ICON[notice.phase]}
                data-size="14"
                className={spinning ? "pw-anim-spin" : undefined}
                aria-hidden="true"
              ></i>
            </span>
            <span className="pw-grow" style={{ fontVariantNumeric: "tabular-nums" }}>
              {t(retryNoticeMessageKey(notice.phase), {
                attempt: notice.attempt,
                max: notice.maxRetries > 0 ? notice.maxRetries : notice.attempt,
              })}
              {notice.errorMessage ? <span className="pw-dim"> — {notice.errorMessage}</span> : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}
