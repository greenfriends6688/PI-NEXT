import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { shouldUseVisualViewportHeight, KEYBOARD_MIN_HEIGHT_PX } = await jiti.import("./useViewportHeight.ts");

test("uses the visual viewport for a focused editor when the keyboard shrinks it", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 510,
    viewportScale: 1,
  }), true);
});

test("does not keep the keyboard height after the visual viewport restores", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 844,
    viewportScale: 1,
  }), false);
});

test("restores the dynamic height as soon as the editor loses focus", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: false,
    innerHeight: 844,
    viewportHeight: 510,
    viewportScale: 1,
  }), false);
});

test("does not mistake pinch zoom for an open keyboard", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 422,
    viewportScale: 2,
  }), false);
});

test("keeps the dynamic viewport height when the visual viewport is not reduced", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 844,
    viewportScale: 1,
  }), false);
});

// fork:viewport-keyboard-settle（对齐上游 0.10）—— 两条修正各有各的坑。
test("ignores a page scroll of a few pixels instead of calling it a keyboard", () => {
  // Safari 工具栏/安全区变化只有几十像素；旧判据是 `> 1`，随手一滚就改高度。
  assert.equal(KEYBOARD_MIN_HEIGHT_PX, 60);
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 800,
    viewportScale: 1,
  }), false);
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 844 - KEYBOARD_MIN_HEIGHT_PX - 1,
    viewportScale: 1,
  }), true);
});

test("compares against the zoomed height so a zoomed page is not mistaken for a keyboard", () => {
  // 缩放本身把 visual viewport 变成 innerHeight / scale；拿未缩放的高度比，任何缩放过的
  // 页面都会被判成「键盘开着」，而 iOS 输入框聚焦时的自动缩放恰好让那次 resize 被跳过。
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 600,
    viewportScale: 2, // 844 / 2 = 422，未缩放地看差 244px（假的），缩放后差 -178px
  }), false);
  // 真键盘在缩放页面上仍然要被认出来：zoom 后的布局高度 844/1.5 ≈ 563，键盘占掉 200。
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 563 - 200,
    viewportScale: 1.5,
  }), true);
});
