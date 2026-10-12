/**
 * fork:feature-toggles —— 「设置 → 界面与功能」的开关表（**单一真值**）。
 *
 * 这一节回答的是用户 2026-10-13 的原话：「右侧边栏和顶部的各种 icon 的显示或功能的
 * 启用，我想让你在设置中帮我加个开关，这样的话我好去进行控制」。
 *
 * 两条硬规矩，写在这里免得实现时走样：
 *
 * 1. **每个开关必须真的断开一条路径**，不能只是把按钮藏起来。藏了但工具还在注册，
 *    模型照样会调、照样会出网 —— 那不叫关。
 * 2. **两类开关的生效时机不同**，所以 `scope` 是数据不是注释：
 *    · `session`：工具类。扩展在**会话启动时**加载，所以关掉对新会话生效
 *      （设置页据此显示「新会话生效」徽标，与本仓内置子代理总开关同一口径）。
 *    · `ui`：界面类。渲染时读一次即可，**立刻生效**。
 *
 * 只存**差异**：`{ features: { browser: false } }`，默认值改了不需要迁移旧文件。
 * 这个模块必须保持客户端安全（设置页要用它的 id 与文案键），
 * 碰 `node:fs` 的那一半在 `lib/feature-settings.ts`。
 */

export const FEATURE_IDS = [
  "browser",
  "webSearch",
  "imageGen",
  "sessionAutoName",
  "terminalPane",
  "gitGraph",
  "tracePane",
  "chatMinimap",
] as const;

export type FeatureId = (typeof FEATURE_IDS)[number];

/** 关掉它，是新会话生效还是立刻生效。 */
export type FeatureScope = "session" | "ui";

export interface FeatureDescriptor {
  id: FeatureId;
  scope: FeatureScope;
  /**
   * 默认值。**八个全开** —— 这一节是「让你能关」，不是「替你决定」：
   * 默认关掉内置浏览器会把用户正在用的能力悄悄拿走，那是另一回事。
   */
  defaultOn: boolean;
  labelKey: string;
  hintKey: string;
}

export const FEATURE_DESCRIPTORS: readonly FeatureDescriptor[] = [
  {
    id: "browser",
    scope: "session",
    defaultOn: true,
    labelKey: "settings.features.browser",
    hintKey: "settings.features.browserHint",
  },
  {
    id: "webSearch",
    scope: "session",
    defaultOn: true,
    labelKey: "settings.features.webSearch",
    hintKey: "settings.features.webSearchHint",
  },
  {
    id: "imageGen",
    scope: "session",
    defaultOn: true,
    labelKey: "settings.features.imageGen",
    hintKey: "settings.features.imageGenHint",
  },
  {
    id: "sessionAutoName",
    scope: "session",
    defaultOn: true,
    labelKey: "settings.features.sessionAutoName",
    hintKey: "settings.features.sessionAutoNameHint",
  },
  {
    id: "terminalPane",
    scope: "ui",
    defaultOn: true,
    labelKey: "settings.features.terminalPane",
    hintKey: "settings.features.terminalPaneHint",
  },
  {
    id: "gitGraph",
    scope: "ui",
    defaultOn: true,
    labelKey: "settings.features.gitGraph",
    hintKey: "settings.features.gitGraphHint",
  },
  {
    id: "tracePane",
    scope: "ui",
    defaultOn: true,
    labelKey: "settings.features.tracePane",
    hintKey: "settings.features.tracePaneHint",
  },
  {
    id: "chatMinimap",
    scope: "ui",
    defaultOn: true,
    labelKey: "settings.features.chatMinimap",
    hintKey: "settings.features.chatMinimapHint",
  },
];

export type FeatureFlags = Record<FeatureId, boolean>;

export function isFeatureId(value: unknown): value is FeatureId {
  return typeof value === "string" && (FEATURE_IDS as readonly string[]).includes(value);
}

export function defaultFeatureFlags(): FeatureFlags {
  const flags = {} as FeatureFlags;
  for (const descriptor of FEATURE_DESCRIPTORS) flags[descriptor.id] = descriptor.defaultOn;
  return flags;
}

/**
 * 偏好文件里的原始值 → 完整开关表。认不出的键与不是布尔的项**原样忽略**（不抛）：
 * 这个文件是手改得到的，坏一行不该让整个设置页打不开。
 */
export function resolveFeatureFlags(raw: unknown): FeatureFlags {
  const flags = defaultFeatureFlags();
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return flags;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isFeatureId(key) && typeof value === "boolean") flags[key] = value;
  }
  return flags;
}

/** 只留与默认值不同的项 —— 落盘的就是这个（默认值以后可以改，不用迁移）。 */
export function featureOverrides(flags: FeatureFlags): Partial<Record<FeatureId, boolean>> {
  const overrides: Partial<Record<FeatureId, boolean>> = {};
  for (const descriptor of FEATURE_DESCRIPTORS) {
    if (flags[descriptor.id] !== descriptor.defaultOn) overrides[descriptor.id] = flags[descriptor.id];
  }
  return overrides;
}

/** 服务端与工具注册点用的单值查询：坏值一律落回默认。 */
export function isFeatureEnabled(raw: unknown, id: FeatureId): boolean {
  return resolveFeatureFlags(raw)[id];
}

/** 设置页把开关分成两组渲染（与 `scope` 同义，只是给 UI 一个好读的名字）。 */
export function groupFeaturesByScope(): { session: FeatureDescriptor[]; ui: FeatureDescriptor[] } {
  return {
    session: FEATURE_DESCRIPTORS.filter((descriptor) => descriptor.scope === "session"),
    ui: FEATURE_DESCRIPTORS.filter((descriptor) => descriptor.scope === "ui"),
  };
}
