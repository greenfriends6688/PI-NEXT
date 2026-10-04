import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  BROWSER_VIEWPORT_LIMITS,
  BROWSER_VIEWPORT_ZOOM_OPTIONS,
  DEFAULT_BROWSER_VIEWPORT_ZOOM,
  DEFAULT_FREE_VIEWPORT_SIZE,
  clampViewportSize,
  isValidViewportDimension,
  resizeViewportFromDrag,
  resolveViewportRender,
} = await jiti.import("./browser-viewport.ts");

// fork:browser-viewport —— 与 ZCode 的 command-metadata.ts 同值。
// 这两条是**契约**：ZCode 用 agent 的 viewport API 与 UI 共用同一组边界，
// 我们若收窄了就与它的行为对不上，放宽了则视口能拖到面板放不下的尺寸。
test("limits and zoom ladder match the reference", () => {
  assert.deepEqual(BROWSER_VIEWPORT_LIMITS, {
    minWidth: 320, maxWidth: 3840, minHeight: 320, maxHeight: 2160,
  });
  assert.deepEqual([...BROWSER_VIEWPORT_ZOOM_OPTIONS], ["fit", "50", "75", "100", "125", "150", "200"]);
  assert.equal(DEFAULT_BROWSER_VIEWPORT_ZOOM, "fit");
});

test("clampViewportSize pulls illegal input into range instead of producing NaN", () => {
  assert.deepEqual(clampViewportSize({ width: 800, height: 600 }), { width: 800, height: 600 });
  assert.deepEqual(clampViewportSize({ width: 10, height: 10 }), { width: 320, height: 320 });
  assert.deepEqual(clampViewportSize({ width: 99999, height: 99999 }), { width: 3840, height: 2160 });
  // NaN / Infinity / 0 / 负数：全部回落到下限，绝不能漏一个 NaN 进布局。
  for (const bad of [NaN, Infinity, -Infinity, 0, -5]) {
    const out = clampViewportSize({ width: bad, height: bad });
    assert.deepEqual(out, { width: 320, height: 320 }, `${bad} 没被夹住`);
  }
  // 非整数按四舍五入，不留半像素。
  assert.deepEqual(clampViewportSize({ width: 800.6, height: 600.4 }), { width: 801, height: 600 });
});

// 填满与自由尺寸是两条不同的路：填满时视口就是容器，不该再叠一层缩放。
test("no viewport means fill, no extra scale", () => {
  const out = resolveViewportRender(null, "fit", { width: 900, height: 700 });
  assert.deepEqual(out, { renderWidth: 900, renderHeight: 700, scale: 1 });
});

test("fit scales the page down to the container without touching its css size", () => {
  // 1280×720 装进 640×720 的容器 → 缩到一半。
  const out = resolveViewportRender({ width: 1280, height: 720 }, "fit", { width: 640, height: 720 });
  assert.equal(out.scale, 0.5);
  assert.equal(out.renderWidth, 640);
  assert.equal(out.renderHeight, 360);
});

// 其余档是**页面自身缩放**，视口 CSS 尺寸不变 —— 与 fit 是两段语义。
test("fixed zoom scales the rendered page, not the css viewport", () => {
  const out = resolveViewportRender({ width: 1280, height: 720 }, "50", { width: 640, height: 720 });
  assert.equal(out.scale, 0.5);
  assert.equal(out.renderWidth, 640);
  assert.equal(out.renderHeight, 360);
  const full = resolveViewportRender({ width: 1280, height: 720 }, "100", { width: 640, height: 720 });
  assert.equal(full.scale, 1);
  assert.equal(full.renderWidth, 1280);
});

test("a container smaller than the page must not produce a negative or NaN scale", () => {
  const out = resolveViewportRender({ width: 1280, height: 720 }, "fit", { width: 0, height: 0 });
  assert.ok(Number.isFinite(out.scale) && out.scale > 0, `scale=${out.scale}`);
  assert.ok(Number.isFinite(out.renderWidth) && Number.isFinite(out.renderHeight));
});

// 视口居中 ⇒ 尺寸 = 指针到所贴那条边的距离 × 2。写成这个形式左右对称，
// 而且「拉到面板边缘」天然得到容器整宽/整高；写成「指针位置减一个边距」则
// 左右不对称，拉到边缘对不齐。
test("drag handles measure from the edge they hug, doubled for the centred box", () => {
  const container = { width: 1000, height: 800 };

  // 右把手：指针 300px 处 → 宽 (1000-300)*2 = 1400。
  const right = resizeViewportFromDrag({ width: 300, height: 700 }, container, { x: "right", y: "none" });
  assert.equal(right.width, 1400);
  assert.equal(right.height, 320, "不管 y 时回落到下限，而不是保留旧值");

  // 左把手：指针 300px 处 → 宽 300*2 = 600。左右对称。
  const left = resizeViewportFromDrag({ width: 300, height: 0 }, container, { x: "left", y: "none" });
  assert.equal(left.width, 600);

  // 拉到面板边缘 → 容器整宽/整高，不是 0 也不是溢出。
  const toRightEdge = resizeViewportFromDrag({ width: 0, height: 0 }, container, { x: "right", y: "bottom" });
  assert.equal(toRightEdge.width, 2000);
  assert.equal(toRightEdge.height, 1600);

  // 越界拖：指针远远拖过对边时夹回上限，不能产生一个无限大的视口。
  const over = resizeViewportFromDrag({ width: -5000, height: 0 }, container, { x: "right", y: "none" });
  assert.equal(over.width, BROWSER_VIEWPORT_LIMITS.maxWidth);
  // 拖到容器左边 900px 外得到 3800 = (1000+900)*2，仍在边界内，不该被夹。
  const stillLegal = resizeViewportFromDrag({ width: -900, height: 0 }, container, { x: "right", y: "none" });
  assert.equal(stillLegal.width, 3800);
});

test("hand-typed dimensions are validated against the same limits", () => {
  assert.equal(isValidViewportDimension(1280, "width"), true);
  assert.equal(isValidViewportDimension(319, "width"), false);
  assert.equal(isValidViewportDimension(3841, "width"), false);
  assert.equal(isValidViewportDimension(NaN, "width"), false);
  // 宽高各有各的边界（高上限是 2160，不是 3840）。
  assert.equal(isValidViewportDimension(3000, "height"), false);
  assert.equal(isValidViewportDimension(2000, "height"), true);
});
// 非主题值说明：1280×720 来自内容写死的 agent 默认视口，不是设计令牌。
test("the free-size default matches the agent default viewport", () => {
  assert.deepEqual(DEFAULT_FREE_VIEWPORT_SIZE, { width: 1280, height: 720 });
  // 第一次拖把手之前页面就按这个尺寸渲染，不许先闪一个手机宽度。
  assert.ok(isValidViewportDimension(DEFAULT_FREE_VIEWPORT_SIZE.width, "width"));
  assert.ok(isValidViewportDimension(DEFAULT_FREE_VIEWPORT_SIZE.height, "height"));
});

// fork:v5-boards D-23 —— 机型预设（画板帧 A 的五档机型 + 帧 B 的旋转 90°）。
// 这两条是**契约**：机型给的是「一台设备的逻辑视口」，宽高成对（面板里原先的
// 宽度预设是单宽，答的是断点，不是设备），旋转只对调宽高、不动呈现尺寸。
const {
  BROWSER_DEVICE_PRESETS,
  findBrowserDevicePreset,
  resolveDeviceViewport,
  rotateViewportSize,
} = await jiti.import("./browser-viewport.ts");

test("device presets are the five machines on the board, each with a width/height pair", () => {
  assert.deepEqual(
    BROWSER_DEVICE_PRESETS.map((device) => [device.id, device.width, device.height, device.dpr]),
    [
      ["iphone-15", 393, 852, 3],
      ["iphone-16-pro-max", 430, 932, 3],
      ["iphone-se", 375, 667, 2],
      ["pixel-9", 412, 915, 2.6],
      ["galaxy-tab", 800, 1280, 2],
    ],
  );
  // 每档都必须能被既有的自由尺寸校验接受，否则选了机型立刻会被输入框判为非法。
  for (const device of BROWSER_DEVICE_PRESETS) {
    assert.ok(isValidViewportDimension(device.width, "width"), `${device.id} 宽度越界`);
    assert.ok(isValidViewportDimension(device.height, "height"), `${device.id} 高度越界`);
    assert.deepEqual(resolveDeviceViewport(device), { width: device.width, height: device.height });
  }
  // id 唯一：面板靠 id 记「当前是哪一台」。
  assert.equal(new Set(BROWSER_DEVICE_PRESETS.map((d) => d.id)).size, BROWSER_DEVICE_PRESETS.length);
  assert.equal(findBrowserDevicePreset("iphone-15")?.label, "iPhone 15");
  assert.equal(findBrowserDevicePreset("nope"), null);
  assert.equal(findBrowserDevicePreset(null), null);
});

test("rotating swaps the logical pair and stays inside the limits", () => {
  assert.deepEqual(rotateViewportSize({ width: 393, height: 852 }), { width: 852, height: 393 });
  // 转两次回到原样（旋转不是单向的消耗操作）。
  const once = rotateViewportSize({ width: 800, height: 1280 });
  assert.deepEqual(rotateViewportSize(once), { width: 800, height: 1280 });
  // 越界的对调仍被夹回边界，不能产生放不下的视口（对调后各自走**对轴**的边界：
  // 宽过下限按 minWidth 收、高过上限按 maxHeight 收）。
  assert.deepEqual(rotateViewportSize({ width: 4000, height: 100 }), {
    width: BROWSER_VIEWPORT_LIMITS.minWidth,
    height: BROWSER_VIEWPORT_LIMITS.maxHeight,
  });
});
