import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync("design/v3/assets/running.js", "utf8");
const start = src.indexOf("var ICONS = {");
const end = src.indexOf("function injectSprite");
const block = src.slice(start + "var ICONS = ".length, end).trim().replace(/;\s*$/, "");
const ICONS = vm.runInNewContext("(" + block + ")");
const names = Object.keys(ICONS);

const entries = names
  .map((n) => "  " + JSON.stringify(n) + ": " + JSON.stringify(ICONS[n]) + ",")
  .join("\n");

const header = [
  "// 生成自 design/v3/assets/running.js 的 ICONS：54 个按 SF Symbols 笔画重画的图标。",
  "// 不要手改：画板换图标时重跑 scripts/gen-v3-icons.mjs。",
  '"use client";',
  "",
  'import type { CSSProperties } from "react";',
  "",
  "export const ICONS: Record<string, string> = {",
  entries,
  "};",
  "",
  "/** 一次性注入的 symbol 表，放在应用根部，use href 才解析得到。 */",
  "export function IconSprite() {",
  "  return (",
  '    <svg aria-hidden="true" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>',
  "      {Object.entries(ICONS).map(([name, path]) => (",
  '        <symbol key={name} id={"i-" + name} viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: path }} />',
  "      ))}",
  "    </svg>",
  "  );",
  "}",
  "",
  "/** 画板里的 svg.ic > use#i-name。尺寸交给 .ic / .ic-sm 这些类。 */",
  "export function Icon({",
  "  name,",
  '  className = "",',
  "  size,",
  "  style,",
  "}: {",
  "  name: string;",
  "  className?: string;",
  "  size?: number;",
  "  style?: CSSProperties;",
  "}) {",
  "  return (",
  "    <svg",
  '      className={("ic " + className).trim()}',
  "      width={size}",
  "      height={size}",
  "      style={style}",
  '      aria-hidden="true"',
  "    >",
  '      <use href={"#i-" + name} />',
  "    </svg>",
  "  );",
  "}",
  "",
].join("\n");

fs.mkdirSync("components/v3", { recursive: true });
fs.writeFileSync("components/v3/Icon.tsx", header);
console.log("icons", names.length);
