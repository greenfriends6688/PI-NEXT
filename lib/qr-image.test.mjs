// fork:lan-pair-qr —— 静区与尺寸：扫不扫得到就看这三行。
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { qrImage, QR_QUIET_ZONE_MODULES } = await createJiti(import.meta.url).import("./qr-image.ts");

const LINK = "http://192.168.43.6:30143/pair#135793";

function at(image, x, y) {
  return image.modules[y * image.size + x];
}

test("边长 = 版本公式 + 两侧静区，画布边长 = 边长 × 缩放", () => {
  const image = qrImage(LINK, { scale: 6 });
  assert.equal(image.size, image.version * 4 + 17 + QR_QUIET_ZONE_MODULES * 2);
  assert.equal(image.modules.length, image.size * image.size);
  assert.equal(image.pixels, image.size * 6);
});

test("静区整圈都是浅色，且足够宽", () => {
  const image = qrImage(LINK);
  const quiet = QR_QUIET_ZONE_MODULES;
  for (let i = 0; i < image.size; i++) {
    for (const [x, y] of [[i, 0], [i, quiet - 1], [0, i], [quiet - 1, i],
      [i, image.size - 1], [i, image.size - quiet],
      [image.size - 1, i], [image.size - quiet, i]]) {
      assert.equal(at(image, x, y), false, `quiet zone module (${x},${y}) must be light`);
    }
  }
});

test("符号本体落在静区里面（角上的定位图形是深色）", () => {
  const image = qrImage(LINK);
  const quiet = QR_QUIET_ZONE_MODULES;
  assert.equal(at(image, quiet, quiet), true);
  assert.equal(at(image, image.size - 1 - quiet, quiet), true);
  assert.equal(at(image, quiet, image.size - 1 - quiet), true);
});

test("scale 与 quietZone 被夹到合法值，不会画出 0 像素画布", () => {
  assert.equal(qrImage(LINK, { scale: 0 }).pixels, qrImage(LINK, { scale: 1 }).pixels);
  assert.equal(qrImage(LINK, { quietZone: -5 }).size, qrImage(LINK, { quietZone: 0 }).size);
});
