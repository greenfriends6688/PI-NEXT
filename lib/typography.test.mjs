/**
 * lib/typography.test.mjs 对应的被测模块见 ./typography.ts。
 * 中文注释：类型梯度常量的单测（档位映射 + 梯度外归并）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  TEXT, TEXT_PX, TEXT_STEPS, nearestTextStep, nearestTextStepName, textStepPx,
  DESIGN_TEXT, DESIGN_TEXT_PX, DESIGN_TEXT_STEPS, nearestDesignTextStep, TEXT_STEP_TO_DESIGN,
} = await jiti.import("./typography.ts");

test("TEXT 映射到对应的 CSS 变量", () => {
  assert.equal(TEXT.md, "var(--text-md)");
  assert.equal(TEXT["2xs"], "var(--text-2xs)");
  assert.equal(TEXT["3xl"], "var(--text-3xl)");
  assert.equal(Object.keys(TEXT).length, 8);
});

test("TEXT_PX 与 globals.css 的梯度一致（五档收敛后的值）", () => {
  // fork:design-system —— 八档收敛到设计系统的五档 11/12/13/15/20。
  // 名字保留 8 个（48 个组件在用），但实际只剩 5 个不同字号。
  assert.deepEqual({ ...TEXT_PX }, {
    "2xs": 11, xs: 11, sm: 12, md: 13, lg: 15, xl: 15, "2xl": 20, "3xl": 20,
  });
  assert.deepEqual([...TEXT_STEPS], ["2xs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl"]);
  assert.equal(new Set(Object.values(TEXT_PX)).size, 5, "实际只有五个不同字号");
});

test("规范五档与设计系统一致", () => {
  assert.deepEqual({ ...DESIGN_TEXT_PX }, { meta: 11, secondary: 12, body: 13, title: 15, display: 20 });
  assert.deepEqual([...DESIGN_TEXT_STEPS], ["meta", "secondary", "body", "title", "display"]);
  assert.equal(DESIGN_TEXT.body, "var(--text-body)");
  assert.equal(nearestDesignTextStep(14), "body"); // 旧正文 14 归到规范档 body
  assert.equal(nearestDesignTextStep(18), "display");
  assert.equal(nearestDesignTextStep(NaN), "body");
});

test("旧名 → 规范名的对照表覆盖全部八档", () => {
  assert.deepEqual({ ...TEXT_STEP_TO_DESIGN }, {
    "2xs": "meta", xs: "meta", sm: "secondary", md: "body",
    lg: "title", xl: "title", "2xl": "display", "3xl": "display",
  });
});

test("梯度上的值精确命中", () => {
  assert.equal(nearestTextStep(13), "var(--text-md)");
  assert.equal(nearestTextStep(10), "var(--text-2xs)");
  assert.equal(nearestTextStep(24), "var(--text-3xl)"); // 24 ≥ 最大值 → 钳到最大档
  assert.equal(nearestTextStepName(15), "lg"); // lg 与 xl 都是 15，并列取小
});

test("梯度外的值归并到最近档", () => {
  assert.equal(nearestTextStep(9), "var(--text-2xs)"); // 低于最小值钳到最小档
  assert.equal(nearestTextStep(20), "var(--text-3xl)"); // 20 ≥ 最大值 → 钳到最大档
  assert.equal(nearestTextStep(30), "var(--text-3xl)"); // 高于最大值钳到最大档
  assert.equal(nearestTextStep(16.5), "var(--text-lg)"); // 距 15 都是 1.5 → 并列取小
});

test("并列距离收敛到较小档", () => {
  assert.equal(nearestTextStepName(11.5), "2xs"); // 2xs 与 xs 都是 11
  assert.equal(nearestTextStepName(12.5), "sm");
  assert.equal(nearestTextStepName(13.5), "md");
  assert.equal(nearestTextStepName(16.5), "lg");
  assert.equal(nearestTextStepName(21), "3xl"); // 21 ≥ 最大值 → 钳到最大档
});

test("非法输入不抛异常并回退到 md", () => {
  assert.equal(nearestTextStep(NaN), "var(--text-md)");
  assert.equal(nearestTextStep(Infinity), "var(--text-md)");
  assert.equal(nearestTextStepName(NaN), "md");
  assert.equal(textStepPx("md"), 13);
  assert.equal(textStepPx("nope"), undefined);
});
