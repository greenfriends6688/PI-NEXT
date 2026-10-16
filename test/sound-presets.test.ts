import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SOUND_PRESET,
  SOUND_PRESETS,
  SOUND_PRESET_IDS,
  isSoundPresetId,
  soundEnabled,
  soundMotif,
  soundPreset,
} from "../src/renderer/src/lib/sound-presets.ts";

/**
 * The tone library is data, and these are the properties the audio side relies on without
 * checking: every id resolves, a stored id that no longer exists still makes a sound, and
 * each scenario has a shape of its own — a run that failed must not sound like one that
 * finished, which is the whole reason the motif is derived rather than recorded.
 */

test("every preset id resolves to a preset of its own", () => {
  assert.equal(SOUND_PRESETS.length, SOUND_PRESET_IDS.length);
  for (const id of SOUND_PRESET_IDS) {
    const preset = soundPreset(id);
    assert.equal(preset.id, id, `${id} resolves to ${preset.id}`);
    assert.ok(preset.notes.length > 0, `${id} has no notes`);
    assert.ok(preset.notes.every((frequency) => frequency > 0), `${id} has a non-positive frequency`);
    assert.ok(["sine", "triangle", "square", "sawtooth"].includes(preset.wave), `${id} has wave ${preset.wave}`);
  }
  // Two presets that play the same notes through the same wave are one preset.
  const shapes = new Set(SOUND_PRESETS.map((preset) => `${preset.wave}:${preset.notes.join(",")}`));
  assert.equal(shapes.size, SOUND_PRESETS.length, "two presets are the same sound");
});

test("an id no build knows still plays the default", () => {
  assert.equal(soundPreset("bells").id, DEFAULT_SOUND_PRESET);
  assert.equal(soundPreset(undefined).id, DEFAULT_SOUND_PRESET);
  assert.equal(soundPreset(42).id, DEFAULT_SOUND_PRESET);
  assert.equal(soundPreset(null).id, DEFAULT_SOUND_PRESET);
  assert.equal(isSoundPresetId("chime"), true);
  assert.equal(isSoundPresetId("bells"), false);
  assert.equal(isSoundPresetId(undefined), false);
});

test("完成 rises, 出错 falls, 等待 repeats", () => {
  for (const id of SOUND_PRESET_IDS) {
    const preset = soundPreset(id);
    const done = soundMotif(id, "done");
    const error = soundMotif(id, "error");
    const approval = soundMotif(id, "approval");

    assert.deepEqual(
      done.map((note) => note.frequency),
      [...preset.notes],
      `${id}: done is the preset as written`,
    );
    assert.equal(error.length, done.length, `${id}: error keeps the note count`);
    assert.deepEqual(
      error.map((note) => note.frequency),
      [...preset.notes].reverse().map((frequency) => frequency * 0.75),
      `${id}: error is the motif inverted and a fourth down`,
    );
    if (preset.notes.length > 1) {
      assert.ok(
        error.at(-1)!.frequency < done.at(-1)!.frequency,
        `${id}: error must not end higher than done`,
      );
    }
    assert.equal(approval.length, done.length * 2, `${id}: 等待 repeats the motif once`);

    for (const notes of [done, error, approval]) {
      assert.equal(notes[0]!.at, 0, `${id}: a motif starts at its own zero`);
      for (const [index, note] of notes.entries()) {
        assert.ok(note.duration > 0, `${id}: note ${index} has no duration`);
        assert.ok(note.gain > 0 && note.gain <= 0.5, `${id}: note ${index} has gain ${note.gain}`);
        if (index > 0) {
          assert.ok(note.at > notes[index - 1]!.at, `${id}: note ${index} does not come after the last`);
        }
      }
    }
  }
});

test("the switch is its own, and a value nobody wrote means on", () => {
  assert.equal(soundEnabled({}), true);
  assert.equal(soundEnabled({ soundEnabled: undefined }), true);
  assert.equal(soundEnabled({ soundEnabled: true }), true);
  assert.equal(soundEnabled({ soundEnabled: "no" }), true, "a malformed value is not a no");
  assert.equal(soundEnabled({ soundEnabled: false }), false);
});
