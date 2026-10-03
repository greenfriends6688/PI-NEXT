import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { readZipEntries, zipText } from "./document-zip.ts";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildPresentation, readPresentation, updateSlide, DocumentSlideError } = await jiti.import("./document-pptx.ts");

const SLIDES = [
  { title: "季度复盘", bullets: ["收入 120 万", "留存 42%"] },
  { title: "下季度计划", bullets: ["先把 A 做完", "再谈 B"] },
  { title: "谢谢" },
];

test("新建 → 读回：页序、标题、要点按放映顺序", () => {
  const deck = readPresentation(buildPresentation(SLIDES, { title: "复盘" }));
  assert.equal(deck.title, "复盘");
  assert.deepEqual(
    deck.slides.map((slide) => [slide.index, slide.title, slide.bullets]),
    [
      [0, "季度复盘", ["收入 120 万", "留存 42%"]],
      [1, "下季度计划", ["先把 A 做完", "再谈 B"]],
      [2, "谢谢", []],
    ],
  );
});

test("生成的演示带着母版、版式、主题（缺这三件套 PowerPoint 会拒绝打开）", () => {
  const names = readZipEntries(buildPresentation(SLIDES)).map((entry) => entry.name);
  for (const required of [
    "[Content_Types].xml",
    "_rels/.rels",
    "ppt/presentation.xml",
    "ppt/_rels/presentation.xml.rels",
    "ppt/slideMasters/slideMaster1.xml",
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    "ppt/slideLayouts/slideLayout1.xml",
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    "ppt/theme/theme1.xml",
    "ppt/slides/slide1.xml",
    "ppt/slides/_rels/slide1.xml.rels",
  ]) {
    assert.ok(names.includes(required), `缺部件 ${required}`);
  }
  const contentTypes = zipText(readZipEntries(buildPresentation(SLIDES)), "[Content_Types].xml");
  assert.match(contentTypes, /presentationml\.presentation\.main\+xml/);
  assert.match(contentTypes, /ppt\/slides\/slide3\.xml/);
});

test("文本里的换行与特殊字符安全落盘再读回", () => {
  const deck = readPresentation(buildPresentation([{ title: 'A & B <tag>', bullets: ["第一行\n第二行", '"引号"'] }]));
  assert.equal(deck.slides[0].title, "A & B <tag>");
  assert.deepEqual(deck.slides[0].bullets, ["第一行\n第二行", '"引号"']);
});

test("往返：改标题与要点 → 再读回新值", () => {
  const original = buildPresentation(SLIDES);
  const updated = updateSlide(original, 0, { title: "季度复盘（修订）", bullets: ["收入 150 万", "留存 45%", "新增一条"] });
  const deck = readPresentation(updated);
  assert.deepEqual(deck.slides[0], { index: 0, title: "季度复盘（修订）", bullets: ["收入 150 万", "留存 45%", "新增一条"] });
  assert.deepEqual(deck.slides[1], { index: 1, title: "下季度计划", bullets: ["先把 A 做完", "再谈 B"] }, "别的页不动");
  assert.deepEqual(deck.slides[2], { index: 2, title: "谢谢", bullets: [] });
});

test("只改要点时标题原样保留", () => {
  const updated = updateSlide(buildPresentation(SLIDES), 1, { bullets: ["只有一条了"] });
  const deck = readPresentation(updated);
  assert.equal(deck.slides[1].title, "下季度计划");
  assert.deepEqual(deck.slides[1].bullets, ["只有一条了"]);
});

test("只改标题时要点原样保留", () => {
  const updated = updateSlide(buildPresentation(SLIDES), 0, { title: "新标题" });
  assert.deepEqual(readPresentation(updated).slides[0].bullets, ["收入 120 万", "留存 42%"]);
});

test("改页时其余部件逐字不变（母版 / 版式 / 主题 / 别的页）", () => {
  const original = buildPresentation(SLIDES);
  const before = readZipEntries(original);
  const after = readZipEntries(updateSlide(original, 0, { title: "x" }));
  assert.deepEqual(after.map((entry) => entry.name), before.map((entry) => entry.name));
  for (const name of ["ppt/slideMasters/slideMaster1.xml", "ppt/theme/theme1.xml", "ppt/slides/slide2.xml", "ppt/presentation.xml"]) {
    assert.deepEqual(after.find((entry) => entry.name === name), before.find((entry) => entry.name === name), name);
  }
});

test("页码越界与空改动报错时带上演示的真实页数", () => {
  const original = buildPresentation(SLIDES);
  assert.throws(() => updateSlide(original, 9, { title: "x" }), (error) => {
    assert.ok(error instanceof DocumentSlideError);
    assert.match(error.message, /共 3 页/);
    return true;
  });
  assert.throws(() => updateSlide(original, 0, {}), /至少给 title 或 bullets/);
});

test("空 slides 也会产出一个可读的一页演示", () => {
  const deck = readPresentation(buildPresentation([]));
  assert.equal(deck.slides.length, 1);
  assert.equal(deck.slides[0].title, "");
});

test("不是 PowerPoint 演示时报错", () => {
  assert.throws(() => readPresentation(Buffer.from("nope")), /不是 ZIP 容器|不是 PowerPoint/);
});