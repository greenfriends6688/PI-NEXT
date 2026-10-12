"use client";

/**
 * fork:composer-speed — 输入区那枚「实时速度」徽标。
 *
 * fork:upstream-0.12-chat-parity（PR-7c）—— 抽成独立组件并自己订阅流式 store：
 * 以前它是 `ChatWindow` 顶层算出来当 prop 传给 `ChatInput` 的，于是**输入框**也跟着
 * 每个流式片段重渲染。现在只有这枚徽标重渲染，输入框本体不动。
 *
 * 为什么不能直接用 usage：pi 只在消息**收尾**时把 usage 落到 result 上，流式中途
 * `streamingMessage.usage` 恒为空。所以按已流出文本估算：CJK 一字≈1 token，
 * 其余四字符≈1 token（混合中英的实测误差 ~±20%）。
 * 速率 = 估算 token ÷ 首字节以来的秒数，随每个 delta 重算（不额外起 interval）。
 */

import { useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { streamRateKey, streamRateStart } from "@/lib/stream-token-rate";
import { selectIsStreaming, selectStreamingMessage, useStreamingSelector } from "@/hooks/useStreamingSelector";
import type { StreamingStore } from "@/lib/streaming-message";
import type { AgentMessage } from "@/lib/types";

/** 与 `components/fork/PhaseRoll.tsx` 同一形状：impure 的 `performance.now()` 收在
 *  模块级函数里（`react-hooks/purity` 只在组件体内直接调用时才报）。 */
function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** 只需流式回复的正文文本。 */
function answerText(message: AgentMessage | null): string {
  if (!message || message.role !== "assistant") return "";
  let text = "";
  for (const block of message.content) {
    if (block.type === "text") text += block.text;
  }
  return text;
}

export function StreamSpeedBadge({ store }: { store: StreamingStore }) {
  const { t } = useI18n();
  const isStreaming = useStreamingSelector(store, selectIsStreaming);
  const message = useStreamingSelector(store, selectStreamingMessage);
  const text = useMemo(() => answerText(message as AgentMessage | null), [message]);
  const streamSpeed = useMemo(() => {
    if (!isStreaming) return null;
    const chars = text.length;
    // fork:upstream-0.12-chat-parity —— 测量起点按「这条回复」（provider/model/请求时间戳）
    // 存在视图外：切会话会让聊天重挂，重新计时会把已流出的每个 token 除以半秒（#877）。
    const key = message ? streamRateKey(message as { provider?: string; model?: string; timestamp?: number }) : null;
    const now = nowMs();
    const live = streamRateStart(key, chars, now);
    const seconds = (now - live.at) / 1000;
    if (chars === 0 || seconds < 0.5) return null;
    const cjk = (text.match(/[\u3000-\u9fff]/g) ?? []).length;
    return Math.round((cjk + (chars - cjk) / 4) / seconds);
  }, [isStreaming, message, text]);

  if (streamSpeed == null || streamSpeed <= 0) return null;
  return (
    <span className="d-badge" title={t("chat.streamSpeed")} role="status" aria-live="off">
      <i data-ico="gauge" data-size="11" aria-hidden="true"></i>
      {streamSpeed} t/s
    </span>
  );
}
