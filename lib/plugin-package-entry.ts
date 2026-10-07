/**
 * fork:memory —— pi 的 `packages` 条目形状，只有一处实现。
 *
 * 一个包在 `~/.pi/agent/settings.json` 的 `packages` 里可以是裸字符串（`"npm:x"`）
 * 或对象（带 `source` + 资源列表 / `autoload`）。**停用 = 把那四个资源列表清空**
 * （pi 认这个形状 = 这个包不加载任何资源），启用 = 只摘掉被清空的那四个，
 * 别的自有键（例如项目里的 delta 条目）原样留着。
 *
 * 插件页（`app/api/plugins/route.ts`）与「设置 → 记忆」共用这一份 —— 两边各写一套
 * 迟早会分叉，而分叉的表现是「一个页面说关了、另一个页面说开着」。
 */
import type { PackageSource } from "@earendil-works/pi-coding-agent";

export function getPackageSource(entry: PackageSource): string {
  return typeof entry === "string" ? entry : entry.source;
}

export function isDisabledPackage(entry: PackageSource): boolean {
  if (typeof entry === "string") return false;
  return (
    Array.isArray(entry.extensions) && entry.extensions.length === 0 &&
    Array.isArray(entry.skills) && entry.skills.length === 0 &&
    Array.isArray(entry.prompts) && entry.prompts.length === 0 &&
    Array.isArray(entry.themes) && entry.themes.length === 0
  );
}

/** 停用后的条目（四个资源列表清空）。 */
export function disabledPackageEntry(entry: PackageSource): PackageSource {
  return {
    ...(typeof entry === "string" ? { source: entry } : entry),
    extensions: [],
    skills: [],
    prompts: [],
    themes: [],
  };
}

/** 启用后的条目：摘掉那四个列表，剩下的自有键还留着；只剩 source 就回落成裸字符串。 */
export function enabledPackageEntry(entry: PackageSource): PackageSource {
  if (typeof entry === "string") return entry;
  const rest = { ...entry };
  delete rest.extensions;
  delete rest.skills;
  delete rest.prompts;
  delete rest.themes;
  return Object.keys(rest).length > 1 ? rest : entry.source;
}
