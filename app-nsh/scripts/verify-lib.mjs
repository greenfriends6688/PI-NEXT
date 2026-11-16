#!/usr/bin/env node
/**
 * 验证搬迁到 app-nsh/src 的纯 TS 模块（lib/ + i18n/）。
 *
 * 三个阶段：
 *
 *  1. 裸 import（当前进程，`--experimental-strip-types`）：
 *     Node ESM 要求显式扩展名，而 NSH 的 bundler（rolldown + oxc）会解析 `./types`
 *     这类无扩展名 import —— 源码保持原样是对的。失败分三类：
 *       · 「需 bundler 解析」   ERR_MODULE_NOT_FOUND（内部无扩展名 import）
 *       · 「需 bundler 转译」   ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX（如 qrcode.ts 的
 *                              parameter property，strip-only 模式不支持，oxc 能转译）
 *       · FAIL                  其它（真正的错误）
 *
 *  2. 子进程带解析钩子（补 .ts 扩展名 + 极简 jiti shim）+ `--experimental-transform-types`
 *     再 import 一遍 —— 这是「bundler 能解析/能转译」的实际证明。
 *
 *  3. 子进程 `--test` 跑同目录下的 *.test.mjs（同样带钩子）。
 *
 * 用法：
 *   node --experimental-strip-types app-nsh/scripts/verify-lib.mjs
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, "..");
const srcDir = path.join(appDir, "src");

/** 搬迁清单里的模块（src/lib）。 */
const LIB_MODULES = [
  "lib/qrcode.ts",
  "lib/qr-image.ts",
  "lib/delimited-table.ts",
  "lib/file-fuzzy.ts",
  "lib/tool-presets.ts",
  "lib/tool-fields.ts",
  "lib/tool-names.ts",
  "lib/patch.ts",
  "lib/turn-views.ts",
  "lib/message-keys.ts",
  "lib/normalize.ts",
  "lib/transcript-notices.ts",
  "lib/notice-text.ts",
  "lib/turn-duration.ts",
  "lib/display-path.ts",
  "lib/file-types.ts",
  "lib/session-stats-format.ts",
  "lib/codemode-view.ts",
  "lib/stream-token-rate.ts",
];

/** 清单外新增的传递依赖（否则 turn-views / message-keys 无法解析）。 */
const TRANSITIVE_MODULES = [
  "lib/types.ts",
  "lib/message-display.ts",
  "lib/turn-written-files.ts",
  "lib/file-links.ts",
  "lib/apply-patch.ts",
  "lib/prompt-recovery.ts",
];

/** 从 lib/i18n/ 整目录搬来的模块。 */
const I18N_MODULES = [
  "i18n/types.ts",
  "i18n/format.ts",
  "i18n/registry.ts",
  "i18n/messages/en.ts",
  "i18n/messages/zh-CN.ts",
  "i18n/messages/zh-TW.ts",
];

const MODULES = [...LIB_MODULES, ...TRANSITIVE_MODULES, ...I18N_MODULES];

/** 已知不可运行的测试及原因（仍会执行，结果按「已知跳过」归类）。 */
const KNOWN_UNRUNNABLE_TESTS = new Map([
  [
    "lib/message-keys.test.mjs",
    "测试依赖未搬迁的 lib/session-reader.ts（fs/path 的 Node 端会话读取器）；message-keys 本身已验证 OK",
  ],
  [
    "lib/transcript-notices.test.mjs",
    "测试依赖未搬迁的 lib/transcript-notices-server.ts（Node 服务端）+ @earendil-works/pi-coding-agent SDK",
  ],
]);

const HOOKS_SOURCE = `
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const JITI_SHIM_URL = __JITI_SHIM_URL__;
const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

// NSH 的 bundler 解析无扩展名 import，Node ESM 不会 —— 这里替它补上。
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "jiti") return { url: JITI_SHIM_URL, shortCircuit: true };
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND" || !context.parentURL) throw error;
    const resolved = new URL(specifier, context.parentURL);
    if (resolved.protocol !== "file:") throw error;
    const basePath = fileURLToPath(resolved);
    for (const extension of EXTENSIONS) {
      const candidate = basePath + extension;
      if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
    throw error;
  }
}
`;

const JITI_SHIM_SOURCE = `
// 极简 jiti 替身：源仓库的 *.test.mjs 通过 createJiti(url).import("./x.ts") 加载 TS。
export function createJiti(baseUrl) {
  return {
    async import(specifier, options = {}) {
      const url = specifier.startsWith(".") || specifier.startsWith("/")
        ? new URL(specifier, baseUrl).href
        : specifier;
      const namespace = await import(url);
      return options?.default ? namespace.default : namespace;
    },
  };
}

export default createJiti;
`;

const RUNNER_SOURCE = `
import path from "node:path";
import { pathToFileURL } from "node:url";

const [sourceDir, ...modules] = JSON.parse(process.env.VERIFY_MODULES);
const results = [];
for (const relativePath of modules) {
  try {
    const namespace = await import(pathToFileURL(path.join(sourceDir, relativePath)).href);
    results.push({ relativePath, ok: true, exports: Object.keys(namespace).length });
  } catch (error) {
    results.push({ relativePath, ok: false, error: \`\${error?.code ?? ""}: \${error?.message ?? error}\` });
  }
}
console.log(\`@@VERIFY@@\${JSON.stringify(results)}\`);
`;

const stripOnlyErrorKinds = new Map([
  ["ERR_MODULE_NOT_FOUND", "需 bundler 解析"],
  ["ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX", "需 bundler 转译"],
]);

function errorCode(error) {
  return error?.code ?? error?.cause?.code ?? "";
}

async function tryImport(relativePath) {
  try {
    const namespace = await import(pathToFileURL(path.join(srcDir, relativePath)).href);
    return { ok: true, exports: Object.keys(namespace).length };
  } catch (error) {
    return { ok: false, code: errorCode(error), message: String(error?.message ?? error) };
  }
}

function runNode(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: appDir,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

const bar = (label) => `== ${label} `.padEnd(70, "=");
const pad = (value, width) => String(value).padEnd(width);
const width = Math.max(...MODULES.map((entry) => entry.length), 26);

// ------------------------------------------------------------ phase 1：裸 import
const bare = new Map();
for (const relativePath of MODULES) bare.set(relativePath, await tryImport(relativePath));

// ------------------------------------------------------------ 钩子 + 子进程
const tmpDir = await mkdtemp(path.join(os.tmpdir(), "nsh-verify-lib-"));
const shimUrl = pathToFileURL(path.join(tmpDir, "jiti-shim.mjs")).href;
const hooksUrl = pathToFileURL(path.join(tmpDir, "hooks.mjs")).href;
const registerUrl = pathToFileURL(path.join(tmpDir, "register.mjs")).href;
await writeFile(path.join(tmpDir, "jiti-shim.mjs"), JITI_SHIM_SOURCE, "utf8");
await writeFile(
  path.join(tmpDir, "hooks.mjs"),
  HOOKS_SOURCE.replace("__JITI_SHIM_URL__", JSON.stringify(shimUrl)),
  "utf8",
);
await writeFile(
  path.join(tmpDir, "register.mjs"),
  `import { register } from "node:module";\nregister(${JSON.stringify(hooksUrl)});\n`,
  "utf8",
);
await writeFile(path.join(tmpDir, "runner.mjs"), RUNNER_SOURCE, "utf8");

const childEnv = {
  NODE_OPTIONS: `--import ${registerUrl} --no-warnings`,
  VERIFY_MODULES: JSON.stringify([srcDir, ...MODULES]),
};
const childFlags = ["--experimental-transform-types"];

const hookedRun = await runNode(
  [...childFlags, path.join(tmpDir, "runner.mjs")],
  childEnv,
);
const hooked = new Map();
const payload = hookedRun.stdout.split("@@VERIFY@@")[1];
if (!payload) {
  console.error("解析钩子子进程没有输出结果：", hookedRun.stderr);
} else {
  for (const result of JSON.parse(payload)) hooked.set(result.relativePath, result);
}

// ------------------------------------------------------------ phase 3：测试
const testFiles = MODULES
  .filter((entry) => !entry.endsWith(".test.ts"))
  .map((entry) => entry.replace(/\.ts$/, ".test.mjs"))
  .filter((entry) => existsSync(path.join(srcDir, entry)));

const testResults = [];
for (const relativePath of testFiles) {
  const run = await runNode([...childFlags, "--test", path.join(srcDir, relativePath)], childEnv);
  const summary = (name) => (run.stdout.match(new RegExp(`^\\u2139 ${name} (\\d+)$`, "m")) ?? [])[1] ?? "?";
  testResults.push({
    relativePath,
    code: run.code,
    passed: summary("pass"),
    failed: summary("fail"),
    known: KNOWN_UNRUNNABLE_TESTS.get(relativePath),
    details: `${run.stdout}${run.stderr}`,
  });
}

await rm(tmpDir, { recursive: true, force: true });

// ------------------------------------------------------------ 报告
console.log(bar("模块加载（裸 import，node --experimental-strip-types）"));
console.log(pad("module", width), pad("裸 import", 26), "加解析钩子后 (+transform-types)");
for (const relativePath of MODULES) {
  const bareResult = bare.get(relativePath);
  const bareLabel = bareResult.ok
    ? `OK (${bareResult.exports} exports)`
    : (stripOnlyErrorKinds.get(bareResult.code) ?? `FAIL ${bareResult.code}`);
  const hookedResult = hooked.get(relativePath);
  const hookedLabel = bareResult.ok
    ? "-"
    : hookedResult?.ok
      ? `OK (${hookedResult.exports} exports)`
      : `FAIL ${hookedResult?.error ?? "no result"}`.slice(0, 180);
  console.log(pad(relativePath, width), pad(bareLabel, 26), hookedLabel);
}

console.log();
console.log(bar("测试（node --experimental-transform-types --test）"));
let unexpectedTestFailures = 0;
for (const result of testResults) {
  const label = result.code === 0 ? "OK" : result.known ? "已知跳过" : "FAIL";
  if (result.code !== 0 && !result.known) unexpectedTestFailures += 1;
  const tail = result.code === 0
    ? ""
    : `| ${result.known ?? result.details.trim().split("\n").slice(-2).join(" ")}`;
  console.log(pad(result.relativePath, width), pad(label, 8), `pass=${result.passed} fail=${result.failed}`, tail);
}

const needsResolution = MODULES.filter((entry) => bare.get(entry)?.code === "ERR_MODULE_NOT_FOUND");
const needsTransform = MODULES.filter((entry) => bare.get(entry)?.code === "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX");
const realFailures = MODULES.filter((entry) => !bare.get(entry).ok && !hooked.get(entry)?.ok);

console.log();
console.log(
  `模块 ${MODULES.length} 个：裸 import OK ${MODULES.length - needsResolution.length - needsTransform.length}` +
  ` / 需 bundler 解析 ${needsResolution.length} / 需 bundler 转译 ${needsTransform.length}` +
  `；带钩子后全部 OK：${realFailures.length === 0 ? "是" : `否（失败 ${realFailures.length}）`}`,
);
if (needsResolution.length > 0) console.log(`  · 需 bundler 解析：${needsResolution.join(", ")}`);
if (needsTransform.length > 0) console.log(`  · 需 bundler 转译：${needsTransform.join(", ")}`);
console.log(
  `测试 ${testFiles.length} 个：通过 ${testResults.filter((entry) => entry.code === 0).length}` +
  ` / 已知跳过 ${testResults.filter((entry) => entry.code !== 0 && entry.known).length}` +
  ` / 失败 ${unexpectedTestFailures}`,
);

process.exit(realFailures.length > 0 || unexpectedTestFailures > 0 ? 1 : 0);
