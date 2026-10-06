"use client";

import { useEffect, useRef, useState } from "react";
import { createTypewriter } from "@/lib/typewriter-reveal";

/**
 * fork:typewriter-tail —— 把 `text` 按打字机节奏揭示出来，返回「这一帧该显示的那段」。
 *
 * 驱动逻辑在 `lib/typewriter-reveal.ts`（纯逻辑、可注入定时器、单测在同目录）；
 * 这里只负责 React 接线。`enabled = false` 时原样返回入参 —— 不排字、不留定时器，
 * SSR 首帧因此仍是完整文本。
 */
export function useTypewriterReveal(text: string, enabled: boolean): string {
  const [cut, setCut] = useState(text.length);
  const driverRef = useRef<ReturnType<typeof createTypewriter> | null>(null);
  driverRef.current ??= createTypewriter(setCut);
  const driver = driverRef.current;

  useEffect(() => {
    if (!enabled) {
      driver.reset();
      return;
    }
    driver.push(text);
  }, [driver, enabled, text]);

  useEffect(() => () => driver.dispose(), [driver]);

  return enabled ? text.slice(0, cut) : text;
}