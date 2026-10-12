#!/usr/bin/env node
/**
 * Apple platform tiers are defined once in lib/platform-breakpoints.ts.
 * Runtime CSS must use 639/640/1023, not the legacy 640/641/1024 pair.
 */
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FILES = [
  "app/globals.css",
  "app/settings.css",
  "app/wallpaper.css",
  "app/fork-ui.css",
  "app/fork-mac-skeuo.css",
  "app/design/v5-forms.css",
  "app/pwa-settings.css",
  "app/pwa-models-skills.css",
  "app/pwa-plugins-agents.css",
  "design/pi-web-design/assets/board.css",
  "components/AppShell.tsx",
  "hooks/useIsMobile.ts",
  "hooks/useTooltipPolicy.ts",
  "lib/panel-layout.ts",
];

const FORBIDDEN = [
  { pattern: /max-width:\s*640px/g, replacement: "max-width: 639px" },
  { pattern: /min-width:\s*641px/g, replacement: "min-width: 640px" },
  { pattern: /max-width:\s*1024px/g, replacement: "max-width: 1023px" },
  { pattern: /max-width:\s*959px/g, replacement: "max-width: 1023px" },
  { pattern: /min-width:\s*960px/g, replacement: "min-width: 1024px" },
];

const violations = [];
for (const rel of FILES) {
  let source;
  try {
    source = readFileSync(join(ROOT, rel), "utf8");
  } catch {
    continue;
  }
  for (const rule of FORBIDDEN) {
    rule.pattern.lastIndex = 0;
    const lines = source.split("\n");
    for (const [index, line] of lines.entries()) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(line)) {
        violations.push(`${rel}:${index + 1}  ${line.trim()}  → ${rule.replacement}`);
      }
    }
  }
}

if (violations.length) {
  console.error("✗ 平台断点门禁：运行时仍有旧边界");
  console.error(violations.join("\n"));
  console.error("\n真值见 lib/platform-breakpoints.ts；阶段 A 边界为 M0<=639、M1=640-1023、M2>=1024。");
  process.exit(1);
}

console.log(`✓ 平台断点门禁：${FILES.length} 个入口使用 M0/M1/M2 边界`);
