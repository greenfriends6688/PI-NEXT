import assert from "node:assert/strict";
import test from "node:test";

import {
  MODEL_INPUT_MODALITIES,
  modelSupportsModality,
  normalizeInputModalities,
  toggleInputModality,
} from "./model-capabilities.ts";

/*
 * fork:model-capabilities —— 模型的四种输入模态。
 *
 * 这一份是**能力声明**，不是闸门（本仓没有一处拿它拦附件）；所以测试锁的是
 * 「写回 `models.json` 的形状」—— 别让文件里长出认不出的值或一行废话。
 */

test("归一化：永远含 text、去掉认不出的项、顺序稳定", () => {
  assert.deepEqual(normalizeInputModalities(undefined), ["text"]);
  assert.deepEqual(normalizeInputModalities([]), ["text"]);
  assert.deepEqual(normalizeInputModalities(["text"]), ["text"]);
  assert.deepEqual(normalizeInputModalities(["video", "image", "text", "nope"]), ["text", "image", "video"]);
  assert.deepEqual(normalizeInputModalities("image"), ["text"], "非数组一律当没说");
});

test("勾一个模态：写进 input，且 text 永远在", () => {
  assert.deepEqual(toggleInputModality(undefined, "image", true), ["text", "image"]);
  assert.deepEqual(toggleInputModality(["text", "image"], "pdf", true), ["text", "image", "pdf"]);
  // 四种按 MODALITY 的固定顺序排，与勾选先后无关 —— 否则同一份能力会写出两种文件。
  assert.deepEqual(
    toggleInputModality(toggleInputModality(["text"], "video", true), "image", true),
    ["text", "image", "video"],
  );
});

test("取消：只剩 text 时写 undefined（不在文件里留一行废话）", () => {
  assert.equal(toggleInputModality(["text", "image"], "image", false), undefined);
  assert.deepEqual(toggleInputModality(["text", "image", "pdf"], "image", false), ["text", "pdf"]);
  assert.equal(toggleInputModality(undefined, "image", false), undefined);
});

test("查询与勾选同源", () => {
  for (const modality of MODEL_INPUT_MODALITIES) {
    assert.equal(modelSupportsModality(["text", modality], modality), true);
    assert.equal(modelSupportsModality(["text"], modality), false);
  }
});
