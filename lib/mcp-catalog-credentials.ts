/**
 * fork:proma-46-mcp-catalog — 目录里 stdio 类 API Key 的凭据存储。
 *
 * 为什么单独存：pi 的 `mcp.json` 只有 `env` 一个位置能放 stdio 的密钥，而它
 * **无法表达「这份密钥只允许配这条启动命令」**。把密钥写进 `env` 之后，外部把
 * `command` / `args` 改成任意命令（含直接编辑 mcp.json），pi 仍会把密钥注入
 * 新命令——这正是 Proma 用 Keychain + `stdioBinding` 挡掉的路径。
 *
 * 本仓没有 Keychain，于是用一个 0600 的私有 JSON 存：
 *   { "<server>": { kind: "api-key", envName, value, binding: { command, args }, savedAt } }
 * 连接时 `lib/mcp-transport.ts` 的 resolver 只在当前配置与 `binding` 完全一致时
 * 才注入（`stdioCredentialBindingMatches`）。remote 类凭据仍写进 `mcp.json` 的
 * `headers`（Proma 同款，且 remote 没有「命令被改」这个攻击面）。
 *
 * 文件用 `writePrivateFileAtomicSync`（同目录 staging + rename + 0600），与
 * `lib/mcp-config-file.ts` 的不变量一致：任何时刻都读不到半写状态。
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import {
  createStdioCredentialBinding,
  stdioCredentialBindingMatches,
  type StdioCredentialBinding,
} from "./mcp-catalog";

export interface CatalogCredentialRecord {
  kind: "api-key";
  envName: string;
  value: string;
  binding: StdioCredentialBinding;
  savedAt: number;
}

export type CatalogCredentialMap = Record<string, CatalogCredentialRecord>;

export interface CatalogCredentialStoreOptions {
  /** 单测注入；生产默认 `<agentDir>/mcp-catalog-credentials.json`。 */
  file?: string;
  now?: () => number;
}

export function defaultCatalogCredentialFile(): string {
  return join(getAgentDir(), "mcp-catalog-credentials.json");
}

function resolveFile(options?: CatalogCredentialStoreOptions): string {
  return options?.file ?? defaultCatalogCredentialFile();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRecord(value: unknown): CatalogCredentialRecord | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind !== "api-key") return undefined;
  if (typeof value.envName !== "string" || !value.envName) return undefined;
  if (typeof value.value !== "string") return undefined;
  if (!isRecord(value.binding)) return undefined;
  const command = typeof value.binding.command === "string" ? value.binding.command : "";
  const args = Array.isArray(value.binding.args)
    ? value.binding.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  if (!command) return undefined;
  return {
    kind: "api-key",
    envName: value.envName,
    value: value.value,
    binding: createStdioCredentialBinding(command, args),
    savedAt: typeof value.savedAt === "number" ? value.savedAt : 0,
  };
}

/** 解析失败按空表处理：坏文件绝不把其它 server 的凭据一起带崩。 */
export function readCatalogCredentials(options?: CatalogCredentialStoreOptions): CatalogCredentialMap {
  const file = resolveFile(options);
  if (!existsSync(file)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!isRecord(parsed)) return {};
    const result: CatalogCredentialMap = {};
    for (const [name, value] of Object.entries(parsed)) {
      const record = parseRecord(value);
      if (record) result[name] = record;
    }
    return result;
  } catch {
    return {};
  }
}

function writeCatalogCredentials(map: CatalogCredentialMap, options?: CatalogCredentialStoreOptions): void {
  const file = resolveFile(options);
  mkdirSync(dirname(file), { recursive: true });
  writePrivateFileAtomicSync(file, JSON.stringify(map, null, 2));
}

export function saveCatalogCredential(
  serverName: string,
  credential: { envName: string; value: string; binding: StdioCredentialBinding },
  options?: CatalogCredentialStoreOptions,
): void {
  const map = readCatalogCredentials(options);
  map[serverName] = {
    kind: "api-key",
    envName: credential.envName,
    value: credential.value,
    binding: createStdioCredentialBinding(credential.binding.command, credential.binding.args),
    savedAt: options?.now ? options.now() : Date.now(),
  };
  writeCatalogCredentials(map, options);
}

export function removeCatalogCredential(serverName: string, options?: CatalogCredentialStoreOptions): boolean {
  const map = readCatalogCredentials(options);
  if (!(serverName in map)) return false;
  delete map[serverName];
  writeCatalogCredentials(map, options);
  return true;
}

/**
 * 给 `lib/mcp-transport.ts` 的 stdio resolver 用：只在当前 `command` / `args`
 * 与保存时一致时返回 `{ [envName]: value }`，否则返回 undefined（**不注入**）。
 */
export function resolveCatalogCredentialEnvironment(
  serverName: string,
  config: unknown,
  options?: CatalogCredentialStoreOptions,
): Record<string, string> | undefined {
  const record = readCatalogCredentials(options)[serverName];
  if (!record) return undefined;
  if (!stdioCredentialBindingMatches(record.binding, isRecord(config) ? config : {})) return undefined;
  return { [record.envName]: record.value };
}
