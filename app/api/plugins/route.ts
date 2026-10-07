import { NextResponse } from "next/server";
import { existsSync, readFileSync, statSync } from "fs";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import {
  DefaultPackageManager,
  getAgentDir,
  SettingsManager,
  type PackageSource,
  type ResolvedPaths,
  type ResolvedResource,
} from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
// fork:memory —— 记忆包不在插件页露面（开关只由「设置 → 记忆」控制）。
import { MEMORY_PACKAGE_SOURCE } from "@/lib/memory-package";
// fork:memory —— `packages` 条目形状（停用 / 启用）只有一份实现，与「设置 → 记忆」共用。
import {
  disabledPackageEntry,
  enabledPackageEntry,
  getPackageSource,
  isDisabledPackage,
} from "@/lib/plugin-package-entry";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getProjectTrustStatus } from "@/lib/project-trust";
import { isPluginSourceCheckable } from "@/lib/plugin-updates";
import type {
  PluginDiagnostic,
  PluginPackageInfo,
  PluginResourceCounts,
  PluginResourceInfo,
  PluginResourceKind,
  PluginScope,
  PluginStandaloneExtensionInfo,
  PluginsResponse,
} from "@/lib/api-types";

export const dynamic = "force-dynamic";

type PluginAction = "install" | "remove" | "update" | "disable" | "enable";

function emptyCounts(): PluginResourceCounts {
  return { extensions: 0, skills: 0, prompts: 0, themes: 0 };
}

function toPluginScope(scope: string): PluginScope {
  return scope === "project" ? "project" : "global";
}

function keyFor(source: string, scope: PluginScope): string {
  return `${scope}\0${source}`;
}

function getDisabledPackages(settingsManager: SettingsManager): Map<string, boolean> {
  const disabled = new Map<string, boolean>();
  for (const entry of settingsManager.getGlobalSettings().packages ?? []) {
    disabled.set(keyFor(getPackageSource(entry), "global"), isDisabledPackage(entry));
  }
  for (const entry of settingsManager.getProjectSettings().packages ?? []) {
    disabled.set(keyFor(getPackageSource(entry), "project"), isDisabledPackage(entry));
  }
  return disabled;
}

/**
 * fork:bulk-routes（上游 `eceac13` #1020 移植）—— 一个已启用的**对象型**条目：
 * 它要么在过滤这个包的资源，要么带 `autoload`。停用会把它的资源列表全清空，而
 * Pi Web 不留副本，再启用也回不来那些过滤条件。
 */
function hasEntrySettings(entry: PackageSource): boolean {
  return typeof entry === "object" && !isDisabledPackage(entry);
}

const FILTERED_PACKAGE_ERROR =
  "Has resource filters, which disabling would remove; use the package's own switch";

/**
 * fork:bulk-routes（上游 `eceac13` #1020 移植）—— 一个作用域里的若干包
 * **一次 settings 写入**。返回这个作用域压根没配的 source（`missing`），
 * 以及因为会丢过滤条件而被 `keepEntrySettings` 放过的那些（`kept`）。
 *
 * 已经在目标状态的条目原样留着；启用时只摘掉被清空的那四个资源列表，
 * `autoload` 之类的自有键留下（否则项目里的 delta 条目会被拍扁成裸 source）。
 */
function setPackagesDisabled(
  settingsManager: SettingsManager,
  sources: readonly string[],
  scope: PluginScope,
  disabled: boolean,
  { keepEntrySettings = false }: { keepEntrySettings?: boolean } = {},
): { missing: Set<string>; kept: Set<string> } {
  const current = scope === "project"
    ? settingsManager.getProjectSettings().packages ?? []
    : settingsManager.getGlobalSettings().packages ?? [];
  const missing = new Set(sources);
  const kept = new Set<string>();
  let changed = false;
  const next = current.map((entry): PackageSource => {
    const source = getPackageSource(entry);
    if (!sources.includes(source)) return entry;
    missing.delete(source);
    if (isDisabledPackage(entry) === disabled) return entry;
    if (disabled && keepEntrySettings && hasEntrySettings(entry)) {
      kept.add(source);
      return entry;
    }
    changed = true;
    if (disabled) return disabledPackageEntry(entry);
    return enabledPackageEntry(entry);
  });
  if (changed) {
    if (scope === "project") settingsManager.setProjectPackages(next);
    else settingsManager.setPackages(next);
  }
  return { missing, kept };
}

/** 批量启停里**每一个**包的结果：`error` 为空即写成功，有值表示该包保持原状。
 *  上游把这两个类型放在 `lib/api-types.ts`，那个文件不在本次改动的边界内，
 *  所以路由这边自带一份同形定义。 */
export interface PluginToggleResult {
  source: string;
  scope: PluginScope;
  error?: string;
}

/**
 * fork:bulk-routes（上游 `eceac13` #1020 移植）—— 插件页「整组开/关」的批量形态。
 * 逐包作答：被拒的那个（项目未信任 / 面板加载后这个包已被删 / 带过滤条件、
 * 停用它就得抹掉过滤）不打断其余。
 *
 * `SettingsManager` 不抛读写失败：它跳过那次写入、把错误记下来，`flush()` 照样
 * resolve。所以这里读完 `drainErrors()` 再作答 —— 否则一个坏掉的 settings.json
 * 会被报成「切换成功」。
 */
async function setPackageListDisabled(
  settingsManager: SettingsManager,
  packages: readonly { source: string; scope: PluginScope }[],
  disabled: boolean,
  projectTrusted: boolean,
): Promise<PluginToggleResult[]> {
  const errors = new Map<string, string>();
  for (const scope of ["global", "project"] as const) {
    const sources = packages.filter((pkg) => pkg.scope === scope).map((pkg) => pkg.source);
    if (sources.length === 0) continue;
    if (scope === "project" && !projectTrusted) {
      for (const source of sources) {
        errors.set(keyFor(source, scope), "Project resources must be trusted before modifying project plugins");
      }
      continue;
    }
    // 「整组停用」不得抹掉操作员手配的资源过滤。
    const { missing, kept } = setPackagesDisabled(settingsManager, sources, scope, disabled, {
      keepEntrySettings: true,
    });
    for (const source of missing) errors.set(keyFor(source, scope), "Package is not configured");
    for (const source of kept) errors.set(keyFor(source, scope), FILTERED_PACKAGE_ERROR);
  }
  await settingsManager.flush();
  const settingsErrors = new Map<string, string>();
  for (const { scope, path, error } of settingsManager.drainErrors()) {
    if (!settingsErrors.has(scope)) settingsErrors.set(scope, path ? `${path}: ${error.message}` : error.message);
  }
  return packages.map((pkg) => {
    // 加载失败的作用域读起来也像「没配」，所以它的错误优先。
    const error = settingsErrors.get(pkg.scope) ?? errors.get(keyFor(pkg.source, pkg.scope));
    return error ? { ...pkg, error } : { ...pkg };
  });
}

/** 读 `[{ source, scope }]`，同 key 去重；形态不对就整体退回 null。 */
function readPackageList(value: unknown): { source: string; scope: PluginScope }[] | null {
  if (!Array.isArray(value)) return null;
  const packages = new Map<string, { source: string; scope: PluginScope }>();
  for (const item of value as { source?: unknown; scope?: unknown }[]) {
    const source = typeof item?.source === "string" ? item.source.trim() : "";
    if (!source) return null;
    const scope = readScope(item.scope);
    packages.set(keyFor(source, scope), { source, scope });
  }
  return [...packages.values()];
}

function addCount(counts: PluginResourceCounts, kind: keyof PluginResourceCounts): void {
  counts[kind] += 1;
}

function getResourceName(path: string, kind: PluginResourceKind): string {
  const file = basename(path);
  const ext = extname(file);
  if (kind === "skill" && file.toLowerCase() === "skill.md") return basename(dirname(path));
  if ((kind === "extension" || kind === "theme" || kind === "prompt") && ext) {
    if (kind === "extension" && /^index\.(ts|js)$/.test(file)) return basename(dirname(path));
    return file.slice(0, -ext.length);
  }
  return file;
}

function getRelativePath(resource: ResolvedResource): string {
  const baseDir = resource.metadata.baseDir;
  if (!baseDir) return resource.path;
  const rel = relative(baseDir, resource.path);
  // Normalize to forward slashes so API output is stable across platforms
  // (Node's path.relative returns backslashes on Windows).
  return rel && !rel.startsWith("..") ? rel.split(sep).join("/") : resource.path;
}

function toResourceInfo(resource: ResolvedResource, kind: PluginResourceKind): PluginResourceInfo {
  return {
    kind,
    name: getResourceName(resource.path, kind),
    path: resource.path,
    relativePath: getRelativePath(resource),
  };
}

function getConfiguredVersion(source: string): string | undefined {
  const npmSpec = source.startsWith("npm:") ? source.slice(4) : undefined;
  if (npmSpec) {
    const lastAt = npmSpec.lastIndexOf("@");
    const packageNameEnd = npmSpec.startsWith("@") ? npmSpec.indexOf("/", 1) : 0;
    if (lastAt > packageNameEnd) return npmSpec.slice(lastAt + 1) || undefined;
    return undefined;
  }

  if (source.startsWith("git:") || /^[a-z]+:\/\//.test(source)) {
    const lastAt = source.lastIndexOf("@");
    const lastSlash = source.lastIndexOf("/");
    const lastColon = source.lastIndexOf(":");
    if (lastAt > Math.max(lastSlash, lastColon)) return source.slice(lastAt + 1) || undefined;
  }
  return undefined;
}

// fork:upstream-0.9.2-plugins-description — #868 移植：读取包描述
function readPackageMetadata(installedPath?: string): { packageName?: string; version?: string; description?: string } {
  if (!installedPath) return {};
  try {
    const stats = statSync(installedPath);
    const packageJsonPath = stats.isDirectory()
      ? join(installedPath, "package.json")
      : join(dirname(installedPath), "package.json");
    if (!existsSync(packageJsonPath)) return {};
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      name?: unknown;
      version?: unknown;
      description?: unknown;
    };
    return {
      packageName: typeof parsed.name === "string" ? parsed.name : undefined,
      version: typeof parsed.version === "string" ? parsed.version : undefined,
      description: typeof parsed.description === "string" ? parsed.description : undefined,
    };
  } catch {
    return {};
  }
}

function collectResource(
  resource: ResolvedResource,
  kind: keyof PluginResourceCounts,
  countsByPackage: Map<string, PluginResourceCounts>,
  resourcesByPackage: Map<string, PluginResourceInfo[]>,
  totals: PluginResourceCounts,
): void {
  if (!resource.enabled || resource.metadata.origin !== "package") return;
  const source = resource.metadata.source;
  const scope = toPluginScope(resource.metadata.scope);
  const key = keyFor(source, scope);
  const counts = countsByPackage.get(key) ?? emptyCounts();
  addCount(counts, kind);
  addCount(totals, kind);
  countsByPackage.set(key, counts);
  const resources = resourcesByPackage.get(key) ?? [];
  const resourceKind = kind === "extensions"
    ? "extension"
    : kind === "skills"
      ? "skill"
      : kind === "prompts"
        ? "prompt"
        : "theme";
  resources.push(toResourceInfo(resource, resourceKind));
  resourcesByPackage.set(key, resources);
}

function collectResources(paths: ResolvedPaths): {
  countsByPackage: Map<string, PluginResourceCounts>;
  resourcesByPackage: Map<string, PluginResourceInfo[]>;
  standaloneExtensions: PluginStandaloneExtensionInfo[];
  totals: PluginResourceCounts;
} {
  const countsByPackage = new Map<string, PluginResourceCounts>();
  const resourcesByPackage = new Map<string, PluginResourceInfo[]>();
  const totals = emptyCounts();
  for (const resource of paths.extensions) collectResource(resource, "extensions", countsByPackage, resourcesByPackage, totals);
  for (const resource of paths.skills) collectResource(resource, "skills", countsByPackage, resourcesByPackage, totals);
  for (const resource of paths.prompts) collectResource(resource, "prompts", countsByPackage, resourcesByPackage, totals);
  for (const resource of paths.themes) collectResource(resource, "themes", countsByPackage, resourcesByPackage, totals);
  const standaloneExtensions = paths.extensions
    .filter((resource) => resource.metadata.origin === "top-level")
    .map((resource): PluginStandaloneExtensionInfo => ({
      ...toResourceInfo(resource, "extension"),
      kind: "extension",
      scope: toPluginScope(resource.metadata.scope),
      enabled: resource.enabled,
    }));
  totals.extensions += standaloneExtensions.filter((extension) => extension.enabled).length;
  return { countsByPackage, resourcesByPackage, standaloneExtensions, totals };
}

async function readPlugins(cwd: string): Promise<PluginsResponse> {
  const agentDir = getAgentDir();
  const projectTrust = getProjectTrustStatus(cwd, agentDir);
  const settingsManager = SettingsManager.create(cwd, agentDir, {
    projectTrusted: projectTrust.trusted,
  });
  const packageManager = new DefaultPackageManager({
    cwd,
    agentDir,
    settingsManager,
  });

  const diagnostics: PluginDiagnostic[] = [];
  let countsByPackage = new Map<string, PluginResourceCounts>();
  let resourcesByPackage = new Map<string, PluginResourceInfo[]>();
  let standaloneExtensions: PluginStandaloneExtensionInfo[] = [];
  let totals = emptyCounts();
  const disabledByPackage = getDisabledPackages(settingsManager);

  try {
    const resolved = await packageManager.resolve(async (source) => {
      diagnostics.push({
        type: "warning",
        source,
        message: "Package is configured but not installed yet.",
      });
      return "skip";
    });
    ({ countsByPackage, resourcesByPackage, standaloneExtensions, totals } = collectResources(resolved));
  } catch (error) {
    diagnostics.push({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const packages = packageManager.listConfiguredPackages()
    /* fork:memory —— 记忆包**不在插件页露面**：它的开关只由「设置 → 记忆」那一节控制。
       两处各摆一个开关就是两个入口同一件事，用户看到的是一份列表里混着两种控制面。
       包本身没变（还在 settings.json 的 packages 里、插件页的 API 也照样能改），只是不列。 */
    .filter((pkg) => pkg.source !== MEMORY_PACKAGE_SOURCE)
    .map((pkg) => {
    const scope = toPluginScope(pkg.scope);
    const key = keyFor(pkg.source, scope);
    const disabled = disabledByPackage.get(key) ?? false;
    const counts = countsByPackage.get(key) ?? emptyCounts();
    const resources = resourcesByPackage.get(key) ?? [];
    const resourceCount = counts.extensions + counts.skills + counts.prompts + counts.themes;
    const packageMetadata = readPackageMetadata(pkg.installedPath);
    if (!pkg.installedPath) {
      diagnostics.push({
        type: "warning",
        source: pkg.source,
        message: "Configured package path was not found.",
      });
    }
    return {
      source: pkg.source,
      scope,
      canCheckForUpdates: isPluginSourceCheckable(pkg.source),
      filtered: pkg.filtered,
      disabled,
      installedPath: pkg.installedPath,
      packageName: packageMetadata.packageName,
      version: packageMetadata.version,
      configuredVersion: getConfiguredVersion(pkg.source),
      description: packageMetadata.description,
      counts,
      resources,
      status: disabled ? "disabled" : resourceCount > 0 ? "loaded" : pkg.installedPath ? "installed" : "missing",
    } satisfies PluginPackageInfo;
  });

  return {
    packages,
    standaloneExtensions,
    // 计数跟着列表走：被藏起来的那一条不能还算进「已装 N」里。
    totals: subtractHiddenTotals(totals, countsByPackage),
    diagnostics,
    projectResourcesLoaded: projectTrust.trusted,
  };
}

/** 插件页头部那些「已装 / 启用 / 各资源数」的合计 —— 减掉不露面的记忆包。 */
function subtractHiddenTotals(
  totals: PluginResourceCounts,
  countsByPackage: Map<string, PluginResourceCounts>,
): PluginResourceCounts {
  const hidden = countsByPackage.get(keyFor(MEMORY_PACKAGE_SOURCE, "global"));
  if (!hidden) return totals;
  return {
    extensions: totals.extensions - hidden.extensions,
    skills: totals.skills - hidden.skills,
    prompts: totals.prompts - hidden.prompts,
    themes: totals.themes - hidden.themes,
  };
}

function readScope(scope: unknown): PluginScope {
  return scope === "project" ? "project" : "global";
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  try {
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    return NextResponse.json(await readPlugins(cwd));
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/plugins body: { action, source?, scope?, cwd }
// enable / disable 另收 `packages: [{ source, scope }]` 代替 source/scope，
// 并在响应里加上逐包的 `results`。
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as {
      action?: PluginAction;
      source?: string;
      scope?: PluginScope;
      packages?: unknown;
      cwd?: string;
    };
    if (!body.cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    if (!body.action) return NextResponse.json({ error: "action required" }, { status: 400 });
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(body.cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const agentDir = getAgentDir();
    const projectTrust = getProjectTrustStatus(body.cwd, agentDir);
    const settingsManager = SettingsManager.create(body.cwd, agentDir, {
      projectTrusted: projectTrust.trusted,
    });

    // fork:bulk-routes —— 批量形态先于单条判定，且自带项目信任校验（逐包作答，
    // 不整体 403），所以不能落到下面那条 `scope === "project"` 的单条守卫上。
    if (body.packages !== undefined) {
      if (body.action !== "enable" && body.action !== "disable") {
        return NextResponse.json({ error: "packages is only supported by enable and disable" }, { status: 400 });
      }
      const packages = readPackageList(body.packages);
      if (!packages) {
        return NextResponse.json({ error: "packages must be a list of { source, scope }" }, { status: 400 });
      }
      const results = await setPackageListDisabled(
        settingsManager,
        packages,
        body.action === "disable",
        projectTrust.trusted,
      );
      return NextResponse.json({ ...(await readPlugins(body.cwd)), results });
    }

    const scope = readScope(body.scope);
    if (scope === "project" && !projectTrust.trusted) {
      return NextResponse.json(
        { error: "Project resources must be trusted before modifying project plugins" },
        { status: 403 },
      );
    }
    const packageManager = new DefaultPackageManager({
      cwd: body.cwd,
      agentDir,
      settingsManager,
    });
    const source = body.source?.trim();
    const local = scope === "project";

    if (body.action === "install") {
      if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });
      await packageManager.installAndPersist(source, { local });
    } else if (body.action === "remove") {
      if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });
      await packageManager.removeAndPersist(source, { local });
    } else if (body.action === "update") {
      if (!source && !projectTrust.trusted && packageManager.listConfiguredPackages().some((pkg) => pkg.scope === "project")) {
        return NextResponse.json(
          { error: "Project resources must be trusted before updating project plugins" },
          { status: 403 },
        );
      }
      await packageManager.update(source);
    } else if (body.action === "disable") {
      if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });
      setPackagesDisabled(settingsManager, [source], scope, true);
      await settingsManager.flush();
    } else if (body.action === "enable") {
      if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });
      setPackagesDisabled(settingsManager, [source], scope, false);
      await settingsManager.flush();
    } else {
      return NextResponse.json({ error: `Unsupported action: ${body.action}` }, { status: 400 });
    }

    return NextResponse.json(await readPlugins(body.cwd));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
