/**
 * fork:memory —— 「设置 → 记忆」的服务端那一半。
 *
 * 两件事，别混：
 *   1. **开关（app 自己的）**：`~/.pi/agent/pi-web-preferences.json` 的 `memoryExtensionEnabled`，
 *      **只影响 PI NEXT**。关着时我们在会话创建时把这个扩展从加载结果里摘掉
 *      （`withoutDisabledMemoryExtension`，接在 `rpc-manager` 的 `extensionsOverride` 上），
 *      **不动 pi 的 `packages`** —— 终端 / 其它运行时照旧用它自己的那份记忆。
 *   2. **包状态（只读）**：装没装、版本、在 pi 的 `packages` 里是否启用。这一页只**报**，
 *      不写；写它等于替别的运行时做决定（用户 2026-10-07 的裁定）。
 *
 * 为什么不能只靠「不加载」以外的做法：这个扩展**没有** enabled 字段
 * （`hermes-memory-config.json` 里只有 nudgeInterval / 限额等细项），所以应用侧的开关
 * 只能在「加载/不加载」这一层做。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, SettingsManager, type LoadExtensionsResult, type PackageSource } from "@earendil-works/pi-coding-agent";

import { getPackageSource, isDisabledPackage } from "./plugin-package-entry";
import { readPiWebPreferences, updatePiWebPreferences } from "./pi-web-preferences";

/** pi 的包 source：`pi install npm:pi-hermes-memory` 写进 settings.json 的就是这一串。 */
export const MEMORY_PACKAGE_SOURCE = "npm:pi-hermes-memory";
export const MEMORY_PACKAGE_NAME = "pi-hermes-memory";

export interface MemoryPackageState {
  source: string;
  /** 装到 `<agentDir>/npm/node_modules/` 里了吗（settings 里配了但没装也算未装）。 */
  installed: boolean;
  /** 在 pi 的 `packages` 里且没被停用 —— 终端 / 其它运行时会加载它。只读。 */
  packageEnabled: boolean;
  /** 装了才有的版本号。 */
  version: string | null;
}

export interface MemoryFileInfo {
  name: string;
  bytes: number;
}

export interface MemoryState extends MemoryPackageState {
  /** **本应用**的开关（默认关）。 */
  enabled: boolean;
  /** 记忆目录（扩展默认 `<agentDir>/pi-hermes-memory`）。 */
  memoryDir: string;
  memoryDirExists: boolean;
  /** 目录里的顶层文件（按名字排序），给面板报「存了什么」。 */
  files: MemoryFileInfo[];
  /** 项目记忆目录（`<agentDir>/projects-memory`）。 */
  projectsDir: string;
  /** 扩展自己的细项配置（本页只做开关，改细项去改这个文件）。 */
  configPath: string;
}

export function memoryPackageDir(agentDir = getAgentDir()): string {
  return join(agentDir, "npm", "node_modules", MEMORY_PACKAGE_NAME);
}

export function memoryDirPath(agentDir = getAgentDir()): string {
  return join(agentDir, "pi-hermes-memory");
}

export function memoryProjectsDirPath(agentDir = getAgentDir()): string {
  return join(agentDir, "projects-memory");
}

export function memoryConfigPath(agentDir = getAgentDir()): string {
  return join(agentDir, "hermes-memory-config.json");
}

/** 装了才有版本号；包里的 package.json 读不出来就当没装（不猜版本）。 */
export function readInstalledMemoryVersion(agentDir = getAgentDir()): string | null {
  const manifest = join(memoryPackageDir(agentDir), "package.json");
  if (!existsSync(manifest)) return null;
  try {
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { name?: unknown; version?: unknown };
    if (parsed.name !== MEMORY_PACKAGE_NAME || typeof parsed.version !== "string") return null;
    return parsed.version;
  } catch {
    return null;
  }
}

/**
 * 纯函数：pi 的 `packages` 列表里这一条开着吗。没配 = 关。
 * （这一条只用于**显示**「终端 / 其它运行时会不会加载它」，不决定本应用的开关。）
 */
export function packageEnabledInList(packages: readonly PackageSource[] | undefined): boolean {
  const entry = (packages ?? []).find((item) => getPackageSource(item) === MEMORY_PACKAGE_SOURCE);
  if (entry === undefined) return false;
  return !isDisabledPackage(entry);
}

// ── 本应用的开关（只影响 PI NEXT） ───────────────────────────────────────────

/** 默认**关**：记忆会在用户没盯着的时候写文件，先默认关、由他自己打开。 */
export function isMemoryExtensionEnabled(agentDir = getAgentDir()): boolean {
  return readPiWebPreferences(agentDir).memoryExtensionEnabled === true;
}

export function setMemoryExtensionEnabled(enabled: boolean, agentDir = getAgentDir()): void {
  updatePiWebPreferences((preferences) => ({ ...preferences, memoryExtensionEnabled: enabled }), agentDir);
}

/** 这个加载结果里的扩展是不是 pi-hermes-memory 那个包带的（照 `preferPiWebSubagentExtension` 的匹配法）。 */
function isMemoryExtension(extension: LoadExtensionsResult["extensions"][number]): boolean {
  const source = extension.sourceInfo?.source ?? "";
  const sourcePackage = source.replace(/^npm:/, "").split("@")[0];
  const pathSegments = extension.path.replaceAll("\\", "/").split("/");
  return sourcePackage === MEMORY_PACKAGE_NAME || pathSegments.includes(MEMORY_PACKAGE_NAME);
}

/**
 * 开关关着时，把记忆扩展从加载结果里摘掉（接在 `rpc-manager` 的 `extensionsOverride` 链上）。
 *
 * 它**只摘那一个扩展**：别的包、别的扩展、pi 的 `packages` 配置一个字都不动 ——
 * 所以终端与其它运行时照旧加载它，这就是「只影响 PI NEXT」的落点。
 */
export function withoutDisabledMemoryExtension(
  base: LoadExtensionsResult,
  agentDir = getAgentDir(),
): LoadExtensionsResult {
  if (isMemoryExtensionEnabled(agentDir)) return base;
  const paths = new Set(base.extensions.filter(isMemoryExtension).map((extension) => extension.path));
  if (paths.size === 0) return base;
  return {
    ...base,
    extensions: base.extensions.filter((extension) => !paths.has(extension.path)),
    errors: base.errors.filter((error) => !paths.has(error.path)),
  };
}

// ── 读数（面板用） ───────────────────────────────────────────────────────────

function listMemoryFiles(dir: string): MemoryFileInfo[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        let bytes = 0;
        try {
          bytes = statSync(join(dir, entry.name)).size;
        } catch {
          // 读不到大小就当 0 —— 面板显示的是「有没有」，不是精确值。
        }
        return { name: entry.name, bytes };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function readMemoryState(options: { cwd?: string; agentDir?: string } = {}): Promise<MemoryState> {
  const agentDir = options.agentDir ?? getAgentDir();
  const settingsManager = SettingsManager.create(options.cwd ?? process.cwd(), agentDir);
  const packages = settingsManager.getGlobalSettings().packages;
  const memoryDir = memoryDirPath(agentDir);
  const version = readInstalledMemoryVersion(agentDir);
  return {
    source: MEMORY_PACKAGE_SOURCE,
    installed: version !== null,
    packageEnabled: packageEnabledInList(packages),
    enabled: isMemoryExtensionEnabled(agentDir),
    version,
    memoryDir,
    memoryDirExists: existsSync(memoryDir),
    files: listMemoryFiles(memoryDir),
    projectsDir: memoryProjectsDirPath(agentDir),
    configPath: memoryConfigPath(agentDir),
  };
}
