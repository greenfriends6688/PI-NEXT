/**
 * 界面偏好的总开关（服务端那一半）。
 *
 * 设置页里的每一项都本来就自动生效（主题、字号、工具预设……），但它们各自只存在**当前
 * 浏览器**的 localStorage 里，换一台设备、换一个浏览器、手机扫码进来，全都回到默认值。
 * 所以用户在设置里「设置完却存不下来」的观感是对的：值确实被记住了，只是没跟着账号走。
 *
 * 这里把整份界面偏好收成一个文件 `<agentDir>/ui-preferences.json`（0600），由
 * `/api/ui-preferences` 读写。客户端那一半见 `lib/ui-preferences-client.ts`：它把每条存储键
 * 接到这个文件上，localStorage 只做首屏的乐观缓存。
 *
 * 同步是**逐键**的：手机上改了字号，电脑那边下次打开就会看到，而不会把电脑上刚调过的主题
 * 一起盖掉。时间戳只用来认「谁更新」，不参与冲突合并——最后写入者胜，语义简单到不会有意外。
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { serializeByKey } from "./key-serializer";

export const UI_PREFERENCES_VERSION = 1;
/** value 是 localStorage 原样的字符串：读的一方不必知道每个键是布尔还是数字。 */
export interface UiPreferenceEntry {
  value: string;
  /** 最后写入的毫秒时间戳。 */
  updatedAt: number;
}

export interface UiPreferencesFile {
  version: 1;
  preferences: Record<string, UiPreferenceEntry>;
}

/** 一个键的上限：设置项的值都很短，超长的只可能是别人的东西。 */
const MAX_KEY_LENGTH = 120;
const MAX_VALUE_LENGTH = 4096;
const MAX_ENTRIES = 400;

const LOCK_KEY = Symbol.for("pi-web.uiPreferences");

export function uiPreferencesPath(agentDir = getAgentDir()): string {
  return join(agentDir, "ui-preferences.json");
}

export function emptyUiPreferences(): UiPreferencesFile {
  return { version: UI_PREFERENCES_VERSION, preferences: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 坏文件当空文件：设置永远是「还能用」比「一处损坏就全黑」重要。 */
export function readUiPreferences(agentDir = getAgentDir()): UiPreferencesFile {
  const path = uiPreferencesPath(agentDir);
  if (!existsSync(path)) return emptyUiPreferences();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return emptyUiPreferences();
  }
  if (!isRecord(parsed) || !isRecord(parsed.preferences)) return emptyUiPreferences();
  const preferences: Record<string, UiPreferenceEntry> = {};
  for (const [key, entry] of Object.entries(parsed.preferences)) {
    if (!isRecord(entry) || typeof entry.value !== "string") continue;
    const updatedAt = typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt)
      ? entry.updatedAt
      : 0;
    if (!isValidKey(key) || entry.value.length > MAX_VALUE_LENGTH) continue;
    preferences[key] = { value: entry.value, updatedAt };
  }
  return { version: UI_PREFERENCES_VERSION, preferences };
}

export function isValidKey(key: string): boolean {
  return key.length > 0
    && key.length <= MAX_KEY_LENGTH
    && /^[a-zA-Z0-9._:-]+$/.test(key);
}

function validValue(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_VALUE_LENGTH;
}

export interface PreferencePatch {
  key: string;
  value: string;
}

/** 挑出请求里合法的配对；非法整条丢掉，不让一次坏请求污染文件。 */
export function parsePreferencePatch(input: unknown): PreferencePatch[] {
  if (!isRecord(input)) return [];
  const out: PreferencePatch[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (!isValidKey(key) || !validValue(value)) continue;
    out.push({ key, value });
  }
  return out;
}

/**
 * 逐键合并写入。返回写完之后的整份文件，调用方直接回给浏览器。
 *
 * 只认 `updatedAt` 更新的值：同一个键在两个标签页里几乎同时写时，晚的那个赢，
 * 不会被先到的旧值盖回去。
 */
export async function writeUiPreferences(
  patch: readonly PreferencePatch[],
  now: number = Date.now(),
  agentDir = getAgentDir(),
): Promise<UiPreferencesFile> {
  if (patch.length === 0) return readUiPreferences(agentDir);
  const path = uiPreferencesPath(agentDir);
  return serializeByKey(LOCK_KEY, path, async () => {
    const current = readUiPreferences(agentDir);
    const preferences = { ...current.preferences };
    for (const { key, value } of patch) {
      const existing = preferences[key];
      if (existing && existing.updatedAt > now) continue;
      preferences[key] = { value, updatedAt: now };
    }
    // 超过上限就丢最旧的：设置项再多也不会到 400 条，到不了说明有别的东西在写。
    const entries = Object.entries(preferences);
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
      for (const [key] of entries.slice(MAX_ENTRIES)) delete preferences[key];
    }
    const next: UiPreferencesFile = { version: UI_PREFERENCES_VERSION, preferences };
    mkdirSync(dirname(path), { recursive: true });
    writePrivateFileAtomicSync(path, `${JSON.stringify(next, null, 2)}\n`);
    return next;
  });
}
