import type { ResourceDiagnostic } from "@earendil-works/pi-coding-agent";
import type { SubagentProfile } from "./subagents";
import type { RetrySettings } from "./retry-settings";

export interface SubagentProfilesResponse {
  profiles: SubagentProfile[];
}

export interface SubagentSettingsResponse {
  enabled: boolean;
  maxConcurrent: number;
}

export interface ShellToolSettingsResponse {
  isWindows: boolean;
  powerShellEnabled: boolean;
}

/** `GET/PUT /api/retry-settings` 的响应体（缺字段时回落 pi 的内建默认）。 */
export type RetrySettingsResponse = RetrySettings;

export interface SkillSearchResult {
  package: string;
  installs: string;
  url: string;
  /** 结果来自哪个市场；缺省视为 skills.sh（兼容旧响应）。 */
  source?: "skills.sh" | "skillhub";
  /** 以下仅 SkillHub 提供（skills.sh 的接口没有这些字段）。 */
  description?: string;
  publisher?: string;
  version?: string;
  stars?: number;
}

export type SkillInstallScope = "global" | "project";

export interface SkillInstallInfo {
  package: string;
  scope: SkillInstallScope;
  source: string;
  sourceType?: string;
  skillsShUrl?: string;
  skillPath?: string;
  ref?: string;
  versionHash?: string;
  canCheckForUpdates: boolean;
}

export type SkillUpdateState =
  | "up-to-date"
  | "update-available"
  | "unsupported"
  | "error";

export interface SkillUpdateResult {
  package: string;
  scope: SkillInstallScope;
  state: SkillUpdateState;
  currentVersion?: string;
  latestVersion?: string;
  message?: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
  sourceInfo: {
    source?: string;
    scope?: string;
  };
  install?: SkillInstallInfo;
}

export interface SkillsResponse {
  skills: SkillInfo[];
  diagnostics: ResourceDiagnostic[];
  projectResourcesLoaded: boolean;
}

export interface ProjectTrustStatus {
  requiresTrust: boolean;
  trusted: boolean;
}

export interface AppUpdateResponse {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
}

export interface PushConfigResponse {
  publicKey: string;
}

export type PluginScope = "global" | "project";
export type PluginResourceKind = "extension" | "skill" | "prompt" | "theme";

export interface PluginResourceCounts {
  extensions: number;
  skills: number;
  prompts: number;
  themes: number;
}

export interface PluginDiagnostic {
  type: "warning" | "error";
  message: string;
  source?: string;
  path?: string;
}

export interface PluginResourceInfo {
  kind: PluginResourceKind;
  name: string;
  path: string;
  relativePath: string;
}

export interface PluginStandaloneExtensionInfo extends PluginResourceInfo {
  kind: "extension";
  scope: PluginScope;
  enabled: boolean;
}

export type PluginUpdateState =
  | "update-available"
  | "up-to-date"
  | "unsupported"
  | "error";

export interface PluginUpdateResult {
  source: string;
  scope: PluginScope;
  displayName: string;
  type: "npm" | "git";
  state: PluginUpdateState;
  message?: string;
}

export interface PluginPackageInfo {
  source: string;
  scope: PluginScope;
  canCheckForUpdates: boolean;
  filtered: boolean;
  disabled: boolean;
  installedPath?: string;
  packageName?: string;
  version?: string;
  configuredVersion?: string;
  // fork:upstream-0.9.2-plugins-description — #868 移植
  description?: string;
  counts: PluginResourceCounts;
  resources: PluginResourceInfo[];
  status: "loaded" | "installed" | "missing" | "disabled";
}

export interface PluginsResponse {
  packages: PluginPackageInfo[];
  standaloneExtensions: PluginStandaloneExtensionInfo[];
  totals: PluginResourceCounts;
  diagnostics: PluginDiagnostic[];
  projectResourcesLoaded: boolean;
}

/**
 * fork:mcp-paste —— 粘贴添加用到的三组类型（上游 0.10 `lib/api-types.ts` 的同款定义）。
 * 它们描述的是「这次粘贴读出了什么」：宿主环境引用、配置文件的问题、以及「能不能顺手
 * 信任这个新文件夹」的判断依据。
 */

/** 一个值读了连接进程的环境变量（`${NAME}` / `$NAME`），只记名字、不展开。 */
export interface McpVariableReference extends McpConfigFieldRef {
  variables: string[];
}

/** 一个 `mcp.json` 读不了 / 不成形的原因。 */
export type McpConfigFileProblemReason =
  /** 不是 JSON。 */
  | "unparsable"
  /** 不是一个带 `mcpServers` 对象的 JSON。 */
  | "invalid-shape"
  /** 文件里不是普通文件（目录 / FIFO / 设备）。 */
  | "not-a-file"
  /** 文件大于 1 MiB。 */
  | "too-large"
  /** 声明的 server 数超过面板列得出来的上限。 */
  | "too-many-servers"
  | "unreadable";

export interface McpConfigFileProblem {
  reason: McpConfigFileProblemReason;
  error: string;
}

/** 「顺带信任这个文件夹」的判断依据：这个文件夹有多「宽」。 */
export interface FreshFolderTrustBreadth {
  kind: "home" | "root" | "contains-home" | "contains-agent-dir" | "contains-folder" | "contains-project" | "too-many-folders";
  path: string;
}

/**
 * 添加项目 server 时能否在同一步里信任该文件夹：只限**新建**且不过宽的文件夹。
 * `folder-not-fresh`：SDK 看不到需要信任的东西，但那里有个指向空处的链接
 * （`hasTrustRelevantEntries()`），等它的目标出现就需要信任，所以这一步拒绝。
 */
export type McpTrustFolderInfo =
  | { allowed: true }
  | { allowed: false; reason: "trust-too-broad"; breadth: FreshFolderTrustBreadth }
  | { allowed: false; reason: "folder-not-fresh" };

/**
 * 代码模式（pi 的 `codemode` 扩展）设置。上游 0.10 的新增能力，本仓在
 * `mcp-native-exposure` 把 codemode 注册进会话后就该跟上：这三项都写**全局**
 * `~/.pi/agent/settings.json`，项目级 `.pi/settings.json` 可只读覆盖。
 */

/** 唯一的那个选择：自动（什么都不写，交给 MCP 扩展按需激活）/ 始终开启（`defaultTools` 加 `+codemode`）。 */
export type McpCodemodePreference = "automatic" | "always";

/** 一层设置里的 `codemode.inlineBudget`，codemode 扩展就按这个读。 */
export interface CodemodeInlineBudgetSetting {
  /** 会话用的预算；没设置（被忽略）时用 pi 的默认值。 */
  value?: number;
  /** pi 会忽略的值（非 0 以上的有限数），按缩短后的 JSON 记下原值。 */
  invalid?: string;
}

/**
 * pi 的 `codemode.mode`：codemode 生效时它怎么**呈现**别的工具。
 * `on`（pi 默认）保持它们照常声明给模型；`only` 把 active 的 `direct` 工具
 * （内置、扩展、直连 MCP）从模型那里收起来，只在 codemode 描述里列出，由脚本去调。
 */
export type CodemodeMode = "on" | "only";

/** 一层设置里的 `codemode.mode`。 */
export interface CodemodeModeSetting {
  /** 会话拿到的值：恰好是 `only` 时是 `only`，否则 `on`。 */
  value: CodemodeMode;
  /** 两个都不是的值（pi 读成 `on`），按缩短后的 JSON 记下原值。 */
  invalid?: string;
}

/**
 * fork:codemode-settings —— 一次失败带一句人话 + 一个机器可判的 `reason`。
 * 上游那一整套 `McpRefusalReason` 是它「类型化拒绝」重写的产物（覆盖 project trust / 目录
 * 校验等一整套路由），本仓没有那次重写，所以这里只留本路由真正会返回的几种 reason，
 * 形状与上游一致（`reason` + `error`），面板按 `reason` 翻译、按 `error` 显示诊断。
 */
export type McpRefusalReason =
  /** 写操作没来自本仓自己的页面（origin / host 校验没过）。 */
  | "request-denied"
  /** 写操作的 body 不是 JSON。 */
  | "content-type"
  /** 请求体里带了不止一个设置键，或带了一个不认识的键。 */
  | "invalid-request"
  /** 设置文件被别的进程锁着（pi 的 SettingsManager 也在同一把锁上）。 */
  | "settings-locked"
  /** 粘贴/添加：请求体太大，或根本不是一个能读成 server 的东西。 */
  | "import-failed"
  /** 粘贴/添加：名字为空或不合规（`^[A-Za-z0-9_-]+$`）。 */
  | "name-invalid"
  /** 粘贴/添加：目标文件里已经有同名条目。 */
  | "name-taken"
  /** 粘贴/添加：必填字段缺了（HTTP 缺 url，stdio 缺 command…）。 */
  | "fields-incomplete"
  /** 粘贴/添加：pi 的结构校验没过（详情在 `error`）。 */
  | "server-invalid"
  /** 粘贴/添加：条目引用了 `PI_WEB_PASSWORD`，本仓不替用户把它交给 MCP server。 */
  | "web-password"
  /** 粘贴/添加：字面密钥只能写进全局 `mcp.json`（项目文件归仓库所有）。 */
  | "secret-global-only"
  /** 粘贴/添加：非 pi 的粘贴引用了本进程环境变量，需要用户逐个确认。 */
  | "host-env-confirm"
  /** 其它内部失败（`error` 里有细节）。 */
  | "internal";

export interface McpErrorResponse {
  error: string;
  reason: McpRefusalReason;
}

/** `PUT /api/tools/settings` 的响应：一次读完 PowerShell 与代码模式的全部设置。 */
export interface ToolSettingsResponse {
  isWindows: boolean;
  powerShellEnabled: boolean;
  /** `always` 表示全局 `defaultTools` 让会话一开始 codemode 就是 active。 */
  codemode: McpCodemodePreference;
  /** 全局 `codemode.mode`。 */
  codemodeMode: CodemodeModeSetting;
  /** 全局 `codemode.inlineBudget`。 */
  codemodeInlineBudget: CodemodeInlineBudgetSetting;
}

export type McpScope = "global" | "project";

/**
 * fork:mcp-live-test —— 一个「pi 在本进程里解析的值」的字段引用（上游 0.10 的同名类型）：
 * stdio 的 `env` 值、HTTP 的 header、或 `oauth.clientSecret`。
 * 解析口径见 `lib/mcp-config-values.ts`（上游原样迁入）—— 那份是「哪些字段会在本进程
 * 被展开」的唯一真相，脱敏与 `!command` 串行都按它判断。
 */
export interface McpConfigFieldRef {
  kind: "env" | "header" | "oauth-client-secret";
  /** 变量名 / header 名；`oauth.clientSecret` 没有。 */
  name?: string;
}

export interface McpServerInfo {
  name: string;
  scope: McpScope;
  disabled: boolean;
  kind: "command" | "url" | "socket";
  command?: string;
  args: string[];
  url?: string;
  socket?: string;
  /** 环境变量名列表（不含值，避免泄露） */
  envKeys: string[];
  /** Remaining server options (lifecycle / directTools / timeout, etc.) */
  options: Record<string, unknown>;
  /**
   * fork:mcp-native-exposure —— pi 的工具曝光档。没声明就是 `codemode`（pi 的默认，
   * `core/mcp-servers.d.ts:12`）；`codemode-deferred` 是旧别名，接口层已归一成
   * `codemode`。UI 用它渲染下拉，null = 未声明（写回默认时 pi 会删掉这个键）。
   */
  exposure?: "codemode" | "deferred" | "direct" | "hidden" | null;
  /** Path of the config file that defines this server */
  source: string;
}

export interface McpResponse {
  servers: McpServerInfo[];
  /** Settings merged from global + project */
  settings: Record<string, unknown>;
  diagnostics: string[];
  projectResourcesLoaded: boolean;
  /** fork:mcp-auto-reload —— 写操作带回来的会话重载结果。 */
  reload?: McpReloadReport;
  /** fork:mcp-undo —— 删除后 60 秒内可撤销。 */
  undo?: McpUndoToken;
  /** fork:mcp-undo —— 撤销成功时告知恢复了哪一条。 */
  restored?: { scope: McpScope; name: string };
}

/**
 * fork:mcp-auto-reload —— 写完 MCP 配置后，已经打开的会话重读资源的结果：
 * `reloaded` 立即生效（空闲会话），`deferred` 等当前那一轮跑完再重载。
 */
export interface McpReloadReport {
  reloaded: number;
  deferred: number;
}

/**
 * fork:mcp-undo —— 删除后 60 秒内可撤销。被删条目（含字面密钥）留在服务端内存，
 * 浏览器只拿到这个 token；条目原文永远不过网络。
 */
export interface McpUndoToken {
  scope: McpScope;
  name: string;
  token: string;
  path: string;
  expiresInMs: number;
}
