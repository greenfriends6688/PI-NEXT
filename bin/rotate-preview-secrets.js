"use strict";

// fork:rotate-preview-secrets（上游 cf3ebfba5，2026-10-08）——
// 发布产物里 `.next/prerender-manifest.json` 的 `preview` 块带着**构建期固定**的
// preview 密钥。其中 `previewModeId` 就是 Next 拿来和请求头 `x-prerender-revalidate`
// 比对的值：一旦相等，Next 把该请求当成 on-demand revalidation，**直接跳过
// middleware / proxy**（见 next-server.js 的 runMiddleware）。这个值随每个发布版
// 打进包（npm tarball / DMG / EXE 都带），谁读到公开包，谁就能带上这个头绕过
// `proxy.ts` —— 本仓的 Host/Origin/sec-fetch 校验与 `PI_WEB_LAN_TOKEN` 闸门会一起失效。
//
// `next start` 只从这个文件读这些密钥（没有运行时 env 覆盖），也从不重生成，
// 所以我们在启动 Next 之前把三个 preview 密钥重写成新随机值：公开的那组随即作废、
// 每次启动都不同。放在启动路径而不是 postinstall，是因为后者能被 `--ignore-scripts`
// 跳过；只读安装目录则打警告，而不是静默地继续带着漏洞跑。
//
// 本仓有 **3 条** `next start` 路径，全部要接（上游只接了 bin/pi-web.js 一条）：
//   bin/pi-web.js（npm CLI）· electron/main.js（桌面壳，自己 spawn）· scripts/next-mode.mjs（npm run prod）

// eslint-disable-next-line @typescript-eslint/no-require-imports
const crypto = require("crypto");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");

const PRERENDER_MANIFEST = "prerender-manifest.json";

function freshPreviewSecrets() {
  return {
    // Lengths mirror what Next generates at build time.
    previewModeId: crypto.randomBytes(16).toString("hex"),
    previewModeSigningKey: crypto.randomBytes(32).toString("hex"),
    previewModeEncryptionKey: crypto.randomBytes(32).toString("hex"),
  };
}

/**
 * Rewrite the preview-mode secrets in `.next/prerender-manifest.json` with fresh
 * random values. Never throws: returns a status the caller can surface so a
 * read-only install (where the rewrite cannot happen) is visible rather than a
 * silent bypass.
 *
 * @param {string} nextDir absolute path to the package's `.next` directory
 * @returns {{ ok: boolean, reason?: string, error?: Error }}
 */
function rotatePreviewSecrets(nextDir) {
  const manifestPath = path.join(nextDir, PRERENDER_MANIFEST);

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { ok: false, reason: "missing" };
    }
    return { ok: false, reason: "unreadable", error };
  }

  if (!manifest || typeof manifest !== "object" || typeof manifest.preview !== "object") {
    return { ok: false, reason: "unexpected-shape" };
  }

  manifest.preview = { ...manifest.preview, ...freshPreviewSecrets() };

  // Write to a sibling temp file and rename so a concurrent `next start` never
  // reads a half-written manifest.
  const tempPath = path.join(nextDir, `${PRERENDER_MANIFEST}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tempPath, JSON.stringify(manifest));
    fs.renameSync(tempPath, manifestPath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Best effort: leaving a stray temp file is harmless.
    }
    return { ok: false, reason: "unwritable", error };
  }

  return { ok: true };
}

function getRotationWarning(reason) {
  const detail =
    reason === "unwritable"
      ? "the install directory is not writable"
      : reason === "missing"
        ? "its prerender manifest is missing"
        : reason === "unreadable"
          ? "its prerender manifest could not be read"
          : "its prerender manifest has an unexpected format";
  return [
    `Warning: could not rotate pi-web's preview-mode secrets because ${detail}.`,
    "This instance keeps the published preview id, so a client that knows it can",
    "bypass the proxy's Host/Origin checks and the LAN token gate via the",
    "x-prerender-revalidate header. Run from a writable install, or restrict",
    "network access to this instance.",
  ].join("\n");
}

module.exports = {
  PRERENDER_MANIFEST,
  rotatePreviewSecrets,
  getRotationWarning,
};
