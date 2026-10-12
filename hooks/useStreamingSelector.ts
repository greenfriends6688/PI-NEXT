"use client";

import { useLayoutEffect, useState } from "react";
import type { StreamingState, StreamingStore } from "@/lib/streaming-message";

/**
 * fork:upstream-0.12-chat-parity（PR-7c）—— 取 streaming store 里的一个值；只有它变了
 * 组件才重渲染。`select` 必须稳定（模块级函数）。
 *
 * 用普通 state 更新而不是 `useSyncExternalStore`：后者每个片段自己渲染一次，而 state
 * 更新能让 React 把它渲染前落地的几个片段批到一起，每次渲染只重解析回复的最后一块。
 */
export function useStreamingSelector<T>(store: StreamingStore, select: (state: StreamingState) => T): T {
  const [value, setValue] = useState(() => select(store.getState()));
  useLayoutEffect(() => {
    const update = () => setValue(select(store.getState()));
    // 本次渲染与订阅之间可能落了一个片段。
    update();
    return store.subscribe(update);
  }, [store, select]);
  return value;
}

export const selectIsStreaming = (state: StreamingState) => state.isStreaming;
export const selectHasStreamingContent = (state: StreamingState) => Boolean(state.streamingMessage?.content.length);
export const selectStreamingMessage = (state: StreamingState) => state.streamingMessage;