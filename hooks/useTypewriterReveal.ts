"use client";

import { useEffect, useRef, useState } from "react";
import { createTypewriter, plainRevealCut } from "@/lib/typewriter-reveal";

/**
 * fork:typewriter-tail —— 把 `text` 按打字机节奏揭示出来，返回「这一帧该显示的那段」。
 *
 * 驱动逻辑在 `lib/typewriter-reveal.ts`（纯逻辑、可注入定时器、单测在同目录）；
 * 这里只负责 React 接线。`enabled = false` 时原样返回入参 —— 不排字、不留定时器，
 * SSR 首帧因此仍是完整文本。
 *
 * fork:typewriter-speed（2026-10-06）—— 启用那一刻要 `seed()` 而不是 `push()`：
 * 首帧的 `cut` 就是全文（`useState(text.length)`），不 seed 的话驱动从 0 开始追，
 * 屏幕上已经存在的整段文字会被**从第一个字重打一遍**（切分支、折叠再展开、
 * 流式中途刷新都会撞上）。seed 之后只有**新到的字**才走逐字揭示。
 *
 * `markdown = false` 是给**纯文本**消费方（思考正文）：那里没有 markdown 管线，
 * 未闭合的 `` ` `` / `*` / `_` 回退只会把文字冻住，所以换成只防代理对的切点。
 */
export function useTypewriterReveal(text: string, enabled: boolean, markdown = true): string {
  const [cut, setCut] = useState(text.length);
  const driverRef = useRef<ReturnType<typeof createTypewriter> | null>(null);
  // 驱动只建一次：`markdown` 在同一处调用点上不会变（两个消费方各写死一个值）。
  driverRef.current ??= createTypewriter(setCut, {}, markdown ? {} : { safeCut: plainRevealCut });
  const driver = driverRef.current;
  const wasEnabledRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      wasEnabledRef.current = false;
      driver.reset();
      return;
    }
    if (!wasEnabledRef.current) {
      wasEnabledRef.current = true;
      driver.seed(text);
      return;
    }
    driver.push(text);
  }, [driver, enabled, text]);

  useEffect(() => () => driver.dispose(), [driver]);

  return enabled ? text.slice(0, cut) : text;
}
