"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  DEFAULT_SOUND_SELECTION,
  isValidSelection,
  playPreset,
  getSoundPreset,
  type SoundKind,
} from "@/lib/sound-presets";

/** 选中的音色包持久化键；`pi-sound-enabled` 保持兼容不变。 */
export const SOUND_PRESET_STORAGE_KEY = "pi-sound-preset";

// fork:upstream-0.12-audio-parity —— 提示音结束后上下文再跑多久；以及 resume 超过多久的
// 提示音直接丢弃（#1157/#1178/#1185）。
export const AUDIO_IDLE_SUSPEND_MS = 1000;
export const AUDIO_STALE_CHIME_MS = 3000;

function readStoredSelection(): string {
  if (typeof window === "undefined") return DEFAULT_SOUND_SELECTION.presetId;
  try {
    const stored = localStorage.getItem(SOUND_PRESET_STORAGE_KEY);
    const candidate = stored ? { presetId: stored } : null;
    return candidate && isValidSelection(candidate) ? candidate.presetId : DEFAULT_SOUND_SELECTION.presetId;
  } catch {
    return DEFAULT_SOUND_SELECTION.presetId;
  }
}

/**
 * fork:gap-sound-presets — 原来的实现硬编码一个双音正弦（523.25/659.25Hz），
 * 只有“完成”一种语义。现在改为从 `lib/sound-presets.ts` 读音色包，
 * 并按 4 类语义（complete / blocked / checkpoint / notification）播放。
 * 默认音色包 `soft` 的 composer 就是原来那对音，所以默认听感不变。
 */
function playTone(ctx: AudioContext, kind: SoundKind, presetId: string) {
  // 真实 AudioContext 的结构面与 lib/sound-presets 的 PresetAudioContext 兼容
  //（后者刻意把 connect 声明成方法以启用参数双变性，便于单测注入 fake）。
  playPreset(ctx, presetId, kind);
}

export function useAudio() {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("pi-sound-enabled");
    return stored === null ? true : stored === "true";
  });

  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  // Reuse a single AudioContext so it can be resumed if the browser
  // autoplay policy suspends it (contexts created outside user gestures
  // start in "suspended" state and produce no sound).
  //
  // fork:upstream-0.12-audio-parity —— 空闲时挂起，从不 close：一个运行中的上下文
  // 即使无声也把音频输出流开着（Android 的 AudioMix wake lock，#1157），而 WebKit 只允许
  // 「已在一次手势里启动过」的上下文无需手势恢复。每次发送的 unlock 短暂恢复它，
  // 于是手势持续重建这一点；运行期间由 hold 让它一直跑。
  const ctxRef = useRef<AudioContext | null>(null);
  const getCtx = useCallback((): AudioContext | null => {
    if (ctxRef.current && ctxRef.current.state !== "closed") return ctxRef.current;
    try {
      ctxRef.current = new AudioContext();
    } catch {
      return null;
    }
    return ctxRef.current;
  }, []);

  // 尚未结束的 resume() 调用；空闲挂起要等它们。
  const resumingRef = useRef(0);
  // holdAudio() 拿着的 hold 数；空闲挂起也要等它们。
  const holdsRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const scheduleIdleSuspend = useCallback((ctx: AudioContext) => {
    clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      if (resumingRef.current === 0 && holdsRef.current === 0) ctx.suspend().catch(() => {});
    }, AUDIO_IDLE_SUSPEND_MS);
  }, []);

  // 恢复、跑 `onRunning`，最后一次结束 AUDIO_IDLE_SUSPEND_MS 后挂起 —— 除非那时还有
  // 更新的 resume 或一个 hold 没结束。
  const runBriefly = useCallback((ctx: AudioContext, onRunning: () => void) => {
    resumingRef.current++;
    const settled = () => {
      resumingRef.current--;
      scheduleIdleSuspend(ctx);
    };
    ctx.resume().then(onRunning).catch(() => {}).then(settled);
  }, [scheduleIdleSuspend]);

  const unlockAudio = useCallback((force = false) => {
    if (!force && !enabledRef.current) return;
    const ctx = getCtx();
    if (!ctx || ctx.state === "running") return;
    runBriefly(ctx, () => {});
  }, [getCtx, runBriefly]);

  const toggle = useCallback(() => {
    const next = !enabledRef.current;
    if (next) unlockAudio(true);
    else ctxRef.current?.suspend().catch(() => {});
    enabledRef.current = next;
    localStorage.setItem("pi-sound-enabled", String(next));
    setEnabled(next);
  }, [unlockAudio]);

  // 保持上下文运行到返回的 release 被调用：运行期间，这样它的提示音在锁屏手机上也能响
  // （Firefox for Android 会让一个已挂起上下文的 resume() 一直挂着）。
  const holdAudio = useCallback(() => {
    holdsRef.current++;
    clearTimeout(idleTimerRef.current);
    if (enabledRef.current) {
      const ctx = getCtx();
      if (ctx && ctx.state !== "running") runBriefly(ctx, () => {});
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      holdsRef.current--;
      if (ctxRef.current) scheduleIdleSuspend(ctxRef.current);
    };
  }, [getCtx, runBriefly, scheduleIdleSuspend]);

  const playDone = useCallback((kind: SoundKind = "complete") => {
    if (!enabledRef.current) return;
    const ctx = getCtx();
    if (!ctx) return;
    const presetId = readStoredSelection();
    const requestedAt = Date.now();
    runBriefly(ctx, () => {
      // 恢复期间声音被关掉了。
      if (!enabledRef.current) return;
      // 恢复太久的提示音丢掉：用户回来时再响，什么也没通知到。
      if (Date.now() - requestedAt > AUDIO_STALE_CHIME_MS) return;
      try {
        playTone(ctx, kind, presetId);
      } catch {
        // AudioContext not available
      }
    });
  }, [getCtx, runBriefly]);

  return {
    soundEnabled: enabled,
    onSoundToggle: toggle,
    playDoneSound: playDone,
    unlockAudio,
    holdAudio,
    soundEnabledRef: enabledRef,
    soundPresetId: readStoredSelection(),
    soundPresetComment: getSoundPreset(readStoredSelection())?.comment,
  };
}
