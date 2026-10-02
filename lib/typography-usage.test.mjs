import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

/*
 * fork:dsn-07 — 内联数字字号的全局守卫。
 *
 * DSN-07 分两批把 `fontSize: <数字>` 收口到 `TEXT.*`（`lib/typography.ts`）。逐文件的断言
 * （如 `components/fork/*.test.mjs` 里的那几个）只能守住那几个文件，而漏一处就前功尽弃 ——
 * 于是这里扫全仓：**任何** app/ 或 components/ 下的 ts/tsx 都不允许再写死字号。
 *
 * 允许的写法：
 *   fontSize: TEXT.sm / TEXT["2xs"]   —— CSS 变量，随主题缩放
 *   fontSize: TEXT_PX.md              —— 数值 token（xterm 这类必须拿数字的地方）
 *   fontSize: someVariable            —— 动态值（例如用户在设置里调的 chat 字号）
 *
 * 不允许：`fontSize: 12`、`fontSize: 12.5`。
 */

const ROOTS = ["app", "components"];
const SKIP_DIRS = new Set(["node_modules", ".next", "test-results", "release"]);

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      out.push(...sourceFiles(path));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.test\.(ts|tsx|mjs)$/.test(entry)) continue;
    out.push(path);
  }
  return out;
}

test("no inline px font sizes remain in app/ or components/ (DSN-07)", () => {
  const offenders = [];
  for (const root of ROOTS) {
    for (const file of sourceFiles(join(process.cwd(), root))) {
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, index) => {
        if (/fontSize:\s*[0-9]/.test(line)) {
          offenders.push(`${relative(process.cwd(), file).replace(/\\/g, "/")}:${index + 1}: ${line.trim()}`);
        }
      });
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `inline px font sizes must use TEXT.* / TEXT_PX.* from lib/typography:\n${offenders.join("\n")}`,
  );
});

test("the type ladder and the CSS variables stay in step", () => {
  const typography = readFileSync(join(process.cwd(), "lib", "typography.ts"), "utf8");
  const globals = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
  const dsTokens = readFileSync(join(process.cwd(), "app", "design", "tokens.css"), "utf8");

  // 每个梯度档都必须同时在 typography.ts（TEXT_PX）与 globals.css（--text-*）里有定义，
  // 否则 TEXT.xx 会解析成不存在的变量 —— 那正是「改 token 不生效」的另一种形态。
  for (const step of ["2xs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl"]) {
    // 档名前可能带引号（`"2xs": 10`）也可能不带（`xs: 11`），两种写法都要认。
    const key = `(?:"${step}"|\\b${step}\\b)`;
    assert.match(typography, new RegExp(`${key}:\\s*\\d+`), `TEXT_PX.${step} missing`);
    assert.match(typography, new RegExp(`${key}:\\s*"var\\(--text-${step}\\)"`), `TEXT.${step} missing`);
    // fork:design-system —— globals.css 的值现在指向 app/design/tokens.css 的 --ds-*，
    // 不再是 px 字面量，所以这里接受两种写法。
    assert.match(
      globals,
      new RegExp(`--text-${step}:\\s*(?:\\d+px|var\\(--ds-text-[a-z]+\\));`),
      `--text-${step} missing in globals.css`,
    );
  }

  // 规范五档必须与 app/design/tokens.css 逐值一致 ——
  // 这条是「画板是唯一事实来源」的机器判据：改画板 token 不改产品会红。
  const px = (name) => {
    const match = dsTokens.match(new RegExp(`--ds-text-${name}:\\s*(\\d+(?:\\.\\d+)?)px`));
    assert.ok(match, `--ds-text-${name} missing in app/design/tokens.css`);
    return Number(match[1]);
  };
  assert.deepEqual(
    { meta: px("meta"), secondary: px("secondary"), body: px("body"), title: px("title"), display: px("display") },
    { meta: 11, secondary: 12, body: 13, title: 15, display: 20 },
    "设计系统的五档字阶被改动了 —— 请同步 design/pi-web-design/assets/tokens.css 与本断言",
  );

  // 旧名 → 规范名的值必须真的收敛成五个不同字号。
  const ladder = ["2xs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl"].map((step) => {
    const match = typography.match(new RegExp(`(?:"${step}"|\\b${step}\\b):\\s*(\\d+)`));
    assert.ok(match, `TEXT_PX.${step} missing`);
    return Number(match[1]);
  });
  assert.equal(new Set(ladder).size, 5, "八档必须收敛成五个不同字号");
});
