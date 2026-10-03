/**
 * fork:secrets-never-reach-browser —— MCP 配置里的**字面量密钥不进浏览器**。
 *
 * 起因：本仓的 MCP 详情有个 JSON 编辑器，靠 `POST /api/mcp {action:"get"}` 拿整份 def
 * 再回填文本框 —— 那条路把 `env` / `headers` / `oauth.clientSecret`（以及 url/command/args
 * 里的凭据）**明文送进了浏览器**。上游 0.10 是靠 `lib/mcp-secrets.ts` 从读侧就掩码解决
 * 的（那边同时没有 JSON 编辑器，走的是「粘贴添加」）。
 *
 * 我们要保留 JSON 编辑器，所以按上游的办法做同一件事的另一半：
 *   · **出去**掩码（`maskMcpDefForBrowser`）—— 浏览器拿到的是 `•••`；
 *   · **回来**还原（`restoreMaskedMcpDef`）—— 用户没动过的字段把掩码换回落盘的原值，
 *     动了的按新值写。于是编辑器照样能用，而读一次 JSON 就拿到密钥这条路被关掉。
 *
 * 判定与掩码规则全部复用上游 `lib/mcp-secrets.ts`（`isSecretName` / `looksLikeSecretValue` /
 * `maskUrl` / `maskCommand` / `maskArgs` / `isReferenceOnly`），不在这里另写一套口径。
 */
import {
  SECRET_MASK,
  isReferenceOnly,
  isSecretName,
  maskArgs,
  maskCommand,
  maskUrl,
} from "./mcp-secrets";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 与上游 `lib/mcp-secrets.ts` 的 `literalSecretValue()` 同口径：
 *   · `${VAR}` / `$VAR` 与 `!cmd` 都是**名字**（前者读环境变量、后者现算），不是密钥；
 *   · 名字像密钥（`API_TOKEN`）或值本身像凭据（`Bearer …` / 高熵长串）才掩。
 * 不自己另写判定 —— 两条实现的「像密钥」口径必须一模一样，否则上游掩了这边没掩。
 */
function shouldMaskLiteral(name: string, value: string): boolean {
  if (value === "") return false;
  if (isReferenceOnly(value) || value.startsWith("!")) return false;
  if (isSecretName(name)) return true;
  return /^(?:bearer|basic|token)\s+\S/i.test(value);
}

/**
 * 掩掉一份 def 里所有字面量密钥，供浏览器显示 / 编辑用。
 * 只动**值**，不动键名与结构，所以掩码后的 JSON 仍是合法配置。
 */
export function maskMcpDefForBrowser(def: unknown): Record<string, unknown> {
  if (!isRecord(def)) return {};
  const out: Record<string, unknown> = { ...def };

  for (const kind of ["env", "headers"] as const) {
    const values = def[kind];
    if (!isRecord(values)) continue;
    const masked: Record<string, string> = {};
    for (const [name, value] of Object.entries(values)) {
      masked[name] = (typeof value === "string" && shouldMaskLiteral(name, value)) ? SECRET_MASK : String(value ?? "");
    }
    out[kind] = masked;
  }

  if (isRecord(def.oauth)) {
    const oauth = { ...def.oauth };
    if (typeof oauth.clientSecret === "string" && oauth.clientSecret !== "" && !isReferenceOnly(oauth.clientSecret)) {
      oauth.clientSecret = SECRET_MASK;
    }
    out.oauth = oauth;
  }

  if (typeof def.url === "string") {
    const masked = maskUrl(def.url);
    if (masked.masked) out.url = masked.value;
  }
  if (typeof def.command === "string") {
    const masked = maskCommand(def.command);
    if (masked.masked) out.command = masked.value;
  }
  if (Array.isArray(def.args)) {
    const args = def.args.filter((arg): arg is string => typeof arg === "string");
    const masked = maskArgs(args);
    if (masked.masked) out.args = masked.args;
  }
  return out;
}

/**
 * 把浏览器回传的 def 里的掩码换回落盘的真值，再交给校验/写入。
 *
 * 判据是**等值**：`submitted === SECRET_MASK`。所以用户想真的把某个字段设成 `•••`
 * 这一个字面量是做不到的 —— 这是刻意取舍（上游干脆没有这个编辑器，所以没有这个歧义）。
 * `@param stored` 落盘那份原 def；`@param submitted` 浏览器回传的那份（可能已被手工改过）。
 */
export function restoreMaskedMcpDef(
  submitted: unknown,
  stored: unknown,
): Record<string, unknown> {
  if (!isRecord(submitted)) return isRecord(stored) ? { ...stored } : {};
  const original = isRecord(stored) ? stored : {};
  const out: Record<string, unknown> = { ...submitted };

  const restoreMap = (kind: "env" | "headers") => {
    const values = submitted[kind];
    if (!isRecord(values)) return;
    const storedValues = isRecord(original[kind]) ? original[kind] : {};
    const merged: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(values)) {
      merged[name] = value === SECRET_MASK ? storedValues[name] : value;
    }
    out[kind] = merged;
  };
  restoreMap("env");
  restoreMap("headers");

  if (isRecord(submitted.oauth) && isRecord(original.oauth)) {
    const oauth = { ...submitted.oauth };
    if (oauth.clientSecret === SECRET_MASK) oauth.clientSecret = original.oauth.clientSecret;
    out.oauth = oauth;
  }

  // url / command / args 是**整体**掩码的：整体没变就取回原值，变了就整个当新值。
  if (submitted.url === maskUrl(typeof original.url === "string" ? original.url : "").value) {
    out.url = original.url;
  }
  if (submitted.command === maskCommand(typeof original.command === "string" ? original.command : "").value) {
    out.command = original.command;
  }
  if (Array.isArray(submitted.args) && Array.isArray(original.args)) {
    const maskedOriginal = maskArgs(original.args.filter((arg): arg is string => typeof arg === "string"));
    if (JSON.stringify(submitted.args) === JSON.stringify(maskedOriginal.args)) out.args = original.args;
  }
  return out;
}