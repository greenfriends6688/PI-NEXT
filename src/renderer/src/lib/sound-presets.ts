/**
 * 完成提示音 — the tone library, described as data.
 *
 * A preset is a short motif rather than a recorded asset: two or three notes written as
 * frequency and time, so the app ships no audio files and the whole library is a table a
 * test can read. The *scenario* decides the shape, not the preset: a run that finished
 * rises, one that failed falls, and a prompt waiting on an answer repeats. That is why
 * four presets cover twelve outcomes without four recordings each.
 *
 * The numbers (a fifth apart, ~180 ms between note starts, ~450 ms held) are the shape a
 * completion tone wants: long enough to be heard from another window, short enough not to
 * still be playing when the reader arrives.
 */

export const SOUND_PRESET_IDS = ["chime", "marimba", "ping", "blip"] as const;
export type SoundPresetId = (typeof SOUND_PRESET_IDS)[number];

/** The three things a tone can announce. A user-caused stop announces nothing. */
export type SoundEvent = "done" | "error" | "approval";

export type SoundNote = {
  /** Hertz. */
  frequency: number;
  /** Seconds from the start of the motif. */
  at: number;
  /** Seconds the note is held, release included. */
  duration: number;
  /** Peak gain, 0–1. */
  gain: number;
};

export type SoundPreset = {
  id: SoundPresetId;
  /** Oscillator shape. A marimba is not a chime; the waveform is most of the difference. */
  wave: OscillatorType;
  /** The notes of the 「已完成」 shape, ascending. The other shapes derive from these. */
  notes: readonly number[];
};

export const SOUND_PRESETS: readonly SoundPreset[] = [
  { id: "chime", wave: "sine", notes: [523.25, 659.25] },
  { id: "marimba", wave: "triangle", notes: [392, 523.25, 659.25] },
  { id: "ping", wave: "sine", notes: [880] },
  { id: "blip", wave: "square", notes: [659.25, 987.77] },
];

export const DEFAULT_SOUND_PRESET: SoundPresetId = "chime";

export function isSoundPresetId(value: unknown): value is SoundPresetId {
  return typeof value === "string" && (SOUND_PRESET_IDS as readonly string[]).includes(value);
}

/** The preset a stored id names, or the default — an unknown id must not silence the app. */
export function soundPreset(id: unknown): SoundPreset {
  const found = SOUND_PRESETS.find((preset) => preset.id === id);
  return found ?? SOUND_PRESETS[0]!;
}

/**
 * Whether a completion tone plays. The switch is its own: a person who finds the system
 * notification intrusive but wants to hear that a run finished has no other way to say so,
 * and the two channels answer different questions. Absent means on, like notifications.
 */
export function soundEnabled(settings: { soundEnabled?: unknown }): boolean {
  return settings.soundEnabled !== false;
}

/** Seconds between note starts, per scenario. */
const SPACING: Record<SoundEvent, number> = { done: 0.18, error: 0.22, approval: 0.16 };
/** How long each note is held. */
const HOLD: Record<SoundEvent, number> = { done: 0.45, error: 0.5, approval: 0.3 };
/** Peak gain per note. Quieter than a system alert on purpose — this is a signal, not a siren. */
const GAIN: Record<SoundEvent, number> = { done: 0.18, error: 0.2, approval: 0.14 };

/**
 * The notes one preset plays for one scenario.
 *
 * 「已完成」is the preset as written. 「出错了」is the same motif upside down and a fourth
 * lower, which is the oldest convention there is for "no" in a two-note UI sound. 「等你回
 * 答」is the motif twice, quietly: a prompt is not a failure and not a result, and it has to
 * read as unfinished.
 */
export function soundMotif(id: unknown, event: SoundEvent): SoundNote[] {
  const preset = soundPreset(id);
  const base =
    event === "error" ? [...preset.notes].reverse().map((frequency) => frequency * 0.75) : [...preset.notes];
  const sequence = event === "approval" ? [...base, ...base] : base;
  return sequence.map((frequency, index) => ({
    frequency,
    at: index * SPACING[event],
    duration: HOLD[event],
    gain: GAIN[event],
  }));
}
