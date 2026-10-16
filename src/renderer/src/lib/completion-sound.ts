import { soundMotif, soundPreset, type SoundEvent } from "@/lib/sound-presets";

/**
 * 完成提示音 — the audio half.
 *
 * One `AudioContext` for the life of the window: creating one per tone leaks a hardware
 * voice per bell and, on Safari, runs into a low fixed cap. Nothing plays until a user
 * gesture has produced the context, because a browser refuses to start one without it and
 * an `AudioContext` in `suspended` schedules notes that are heard later, all at once.
 *
 * There is no sound when the window is in front — that decision belongs to the caller,
 * which is the only place that knows whether the reader was already looking (see
 * `use-app-bootstrap.ts`). This module takes the request as given.
 */

let context: AudioContext | null = null;
let unlocked = false;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context || context.state === "closed") context = new Ctor();
  return context;
}

/**
 * Create and resume the context from the next real interaction.
 *
 * Called once from the app shell. Until this has happened the first tone would be silent,
 * which is the one the user is most likely to be waiting for; a gesture that starts a run
 * — a key press, a click — is the safest moment to open it. The listeners leave once they
 * have done their job, so a session that never plays a sound pays one listener per type.
 */
export function installSoundUnlock(): () => void {
  if (typeof window === "undefined") return () => undefined;
  const open = (): void => {
    const ctx = audio();
    if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    unlocked = true;
    window.removeEventListener("pointerdown", open);
    window.removeEventListener("keydown", open);
  };
  window.addEventListener("pointerdown", open, { passive: true });
  window.addEventListener("keydown", open);
  return () => {
    window.removeEventListener("pointerdown", open);
    window.removeEventListener("keydown", open);
  };
}

/** Play one scenario's motif. Silent when there is no audio to play through. */
export function playSound(event: SoundEvent, preset: unknown): void {
  const ctx = audio();
  if (!ctx) return;
  // A context that has never been unlocked starts suspended; resume() is a promise, so the
  // notes are scheduled on the current time and simply run once it does.
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  if (!unlocked && ctx.state === "suspended") return;
  const wave = soundPreset(preset).wave;
  const start = ctx.currentTime + 0.01;
  for (const note of soundMotif(preset, event)) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = wave;
    oscillator.frequency.value = note.frequency;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    const from = start + note.at;
    const to = from + note.duration;
    // A quarter of the hold is the attack, the rest the decay: an instant on/off clicks.
    gain.gain.setValueAtTime(0, from);
    gain.gain.linearRampToValueAtTime(note.gain, from + note.duration * 0.25);
    gain.gain.exponentialRampToValueAtTime(0.001, to);
    oscillator.start(from);
    oscillator.stop(to + 0.02);
  }
}
