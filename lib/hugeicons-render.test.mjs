import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./hugeicons-render.ts");
  } catch {
    return import("./hugeicons-render.ts");
  }
}

const { hugeiconSvg } = await loadSubject();

const PATH = (d, extra = {}) => ["path", { d, stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: "1.5", key: "0", ...extra }];

test("renders the same outer <svg> shell as the existing lucide hydrator", () => {
  // 逐字对齐 icons.js 的 svg()：940 处调用点的 DOM 形状不能因为换数据源而变。
  const svg = hugeiconSvg([PATH("M1 1L2 2")], 14, 1.5);
  assert.match(svg, /^<svg viewBox="0 0 24 24" width="14" height="14"/);
  assert.match(svg, /fill="none"/);
  assert.match(svg, /stroke="currentColor"/);
  assert.match(svg, /stroke-width="1\.5"/);
  assert.match(svg, /stroke-linecap="round"/);
  assert.match(svg, /stroke-linejoin="round"/);
  assert.match(svg, /aria-hidden="true"/);
  assert.match(svg, /focusable="false"/);
  assert.match(svg, /<\/svg>$/);
});

test("drops the React-only `key` prop", () => {
  // Hugeicons 的每个元素都带 key="0"；写进 DOM 就是脏属性。
  const svg = hugeiconSvg([PATH("M1 1L2 2")], 16, 1.5);
  assert.doesNotMatch(svg, /key=/);
});

test("lifts element-level strokeWidth onto the outer svg (so data-stroke wins)", () => {
  // 若把元素级 stroke-width 留下，内层属性会盖过外层，`data-stroke="1"` 失效。
  const svg = hugeiconSvg([PATH("M1 1L2 2", { strokeWidth: "1.5" })], 16, 1);
  assert.equal((svg.match(/stroke-width="/g) || []).length, 1);
  assert.match(svg, /stroke-width="1"/);
});

test("converts camelCase attribute names to kebab-case", () => {
  const svg = hugeiconSvg([PATH("M1 1L2 2", { strokeLineCap: "butt" })], 16, 1.5);
  // 数据里若出现 camelCase 也应正确落成 kebab-case（Hugeicons 目前混用两种写法）
  assert.doesNotMatch(svg, /strokeLineCap/);
});

test("escapes attribute values so a path cannot break out of the tag", () => {
  const svg = hugeiconSvg([PATH('M1 1" onload="alert(1)')], 16, 1.5);
  assert.doesNotMatch(svg, /onload="alert/);
  assert.match(svg, /&quot;/);
});

test("skips empty and missing attribute values", () => {
  const svg = hugeiconSvg([PATH("M1 1L2 2", { fill: "", opacity: undefined })], 16, 1.5);
  assert.doesNotMatch(svg, /fill=""/);
  assert.doesNotMatch(svg, /opacity/);
});

test("renders nested element groups (Hugeicons uses two levels)", () => {
  const groups = [[PATH("M1 1L2 2")], [PATH("M3 3L4 4")]];
  const svg = hugeiconSvg(groups, 16, 1.5);
  assert.equal((svg.match(/<path/g) || []).length, 2);
});

test("returns an empty string for empty input (hydrator treats it as 'no icon')", () => {
  assert.equal(hugeiconSvg([], 16, 1.5), "");
});

test("a realistic icon renders two paths", async () => {
  const { ICON_MAP } = await loadSubject().then(async () => {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./hugeicons-map.ts");
  });
  const data = ICON_MAP["search"];
  assert.ok(Array.isArray(data) && data.length > 0, "search should map to icon data");
  const svg = hugeiconSvg(data, 16, 1.5);
  assert.equal((svg.match(/<path/g) || []).length, 2);
});
