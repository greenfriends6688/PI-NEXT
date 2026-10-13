/**
 * fork:fastvibe-stack (H3) —— 把 Hugeicons 的图标数据渲染成与现有 hydrator
 * **逐字兼容**的 SVG 字符串。
 *
 * ## 为什么要「逐字兼容」
 *
 * 产品的 940 处调用点写的是 `<i data-ico="search" data-size="14">`，由
 * `components/PwIcons.tsx` 把这个 `<i>` 的 innerHTML 换成 SVG。那个 hydrator
 * 现在读的是 `design/pi-web-design/assets/icons.js`（lucide 路径表）。H3 的
 * 「双轨」就是让同一个 hydrator 也能画 Hugeicons —— 于是既要换数据源，又不
 * 能让 940 处的 DOM 形状变样。
 *
 * 现有 `svg()` 产出的外层是：
 *   `<svg viewBox="0 0 24 24" width=N height=N fill="none" stroke="currentColor"
 *     stroke-width=S stroke-linecap="round" stroke-linejoin="round"
 *     aria-hidden="true" focusable="false">…</svg>`
 * 本模块产出同样的外层，只把内层从 lucide 的字符串换成 Hugeicons 的元素数组。
 *
 * ## 数据形状的差异（这是本模块存在的真正原因）
 *
 * lucide（icons.js）：内层是一段**现成的 SVG 字符串**，直接拼进去就行。
 * Hugeicons：内层是 `[tag, props][]` 的数组，例如
 *   `[["path", { d: "M17 17L21 21", stroke: "currentColor", strokeWidth: "1.5", … }]]`
 * 所以要把每个元素序列化成标签。另外 Hugeicons 自带的 `key` 属性是 React 用的，
 * 进 DOM 无意义，必须剔掉（不然每个图标都会带一个 `key="0"` 的脏属性）。
 */

/**
 * Hugeicons 的属性值可以是数字（实测 `strokeWidth` 有时是 `1.5`、有时是 `"1.5"`），
 * 所以这里收 `string | number` —— 早期写成只收 `string` 时，产品里那批数字字面量的
 * 图标会在 `ICON_MAP[name]` 处报「不可赋值」而编译失败。
 */
type HugeIconElement = readonly [string, Record<string, string | number>];

/**
 * 一个图标的完整数据。
 *
 * 形状上它是个**可能嵌套的列表**：元素 `[tag, props]`，或一组元素 `[[tag, props], …]`。
 * 因为嵌套深度不是类型上固定的（Hugeicons 目前最多两层，但没有断言保证），
 * 这里用递归的 `HugeIconNode` 表达，而不是写死两层 —— 写死会让上面那层 `map`
 * 的返回值对不上（TS 的元组长度推断在递归里会收窄成字面量）。
 */
type HugeIconNode = HugeIconElement | readonly HugeIconNode[];
export type HugeIconData = readonly HugeIconNode[];

/** 这些属性是 React 内部用的，写进 DOM 只会变成脏属性。 */
const DROPPED_PROPS = new Set(["key"]);

/** 属性值里需要转义的字符（`&` 必须第一个换，否则会二次转义）。 */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** `strokeWidth` → `stroke-width`（其余属性 Hugeicons 已经是 kebab-case）。 */
function attrName(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function renderElement([tag, props]: HugeIconElement): string {
  const attrs: string[] = [];
  for (const [rawName, value] of Object.entries(props)) {
    if (DROPPED_PROPS.has(rawName)) continue;
    if (value === undefined || value === null || value === "") continue;
    attrs.push(`${attrName(rawName)}="${escapeAttr(String(value))}"`);
  }
  return `<${tag}${attrs.length ? ` ${attrs.join(" ")}` : ""} />`;
}

/**
 * 一个图标的内层标记。
 *
 * Hugeicons 的数据有**两层**：外层是元素列表，但每个条目本身也可能是元素列表
 * （描边版 / 填充版的成对形状）。所以这里递归摊平 —— 只处理已知的两层就够，
 * 深层用同一个函数继续摊，不写死深度。
 */
function renderBody(data: HugeIconData): string {
  const parts: string[] = [];
  for (const entry of data) {
    if (!Array.isArray(entry)) continue;
    // 一个元素 = [tagName, props]（第一项是字符串）；一个分组 = 元素列表（第一项是数组）。
    // `as unknown as` 是必要的：元素与分组在类型上都表现为 `readonly unknown[]`，
    // 而从 `unknown[]` 到元组 `[string, Record<…>]` 的直接 narrow 被 TS 拒绝
    // （元素个数在类型上不可知）。运行时判定靠上一行的 `typeof entry[0]`。
    if (typeof entry[0] === "string") {
      parts.push(renderElement(entry as unknown as HugeIconElement));
    } else {
      parts.push(renderBody(entry as HugeIconData));
    }
  }
  return parts.join("");
}

/**
 * 渲染成与 `icons.js` 的 `svg()` 同形的字符串。
 *
 * `size` / `stroke` 的默认值与现有 hydrator 一致（16 / 1.5），这样
 * `<i data-ico="search">` 不带 `data-size` 时的观感与换图标库之前完全一样。
 *
 * **stroke 的处理**：Hugeicons 自己给每个元素的 `stroke` 是 `currentColor`、
 * `strokeWidth` 是 `1.5`，与图标数据绑在一起。本仓现有的 `data-stroke` 属性
 * 允许调用点覆盖线宽，所以这里把元素级的 `strokeWidth` 去掉，改由外层 `<svg>`
 * 的 `stroke-width` 统一给出 —— 与 lucide 版的行为一字不差（lucide 的路径
 * 本身不带 stroke 属性，全靠外层）。不这样做的话，`data-stroke="1"` 的调用点
 * 会失效（内层属性优先级高于外层）。
 */
export function hugeiconSvg(data: HugeIconData, size: number, stroke: number): string {
  const inner = renderBody(stripStrokeWidth(data));
  if (!inner) return "";
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}"`
    + ' fill="none" stroke="currentColor"'
    + ` stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"`
    + ' aria-hidden="true" focusable="false">'
    + inner
    + "</svg>"
  );
}

/** 递归去掉元素级 `strokeWidth`（见 `hugeiconSvg` 的注释）。 */
function stripStrokeWidth(data: HugeIconData): HugeIconData {
  return data.map((entry): HugeIconNode => {
    if (!Array.isArray(entry)) return entry;
    if (typeof entry[0] === "string") {
      const [tag, props] = entry as unknown as HugeIconElement;
      const { strokeWidth: _drop, ...rest } = props;
      return [tag, rest];
    }
    return stripStrokeWidth(entry as HugeIconData);
  });
}
