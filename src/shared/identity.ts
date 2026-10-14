/**
 * fork:ai-identity —— 「设置 → AI 身份」：聊天里那个助手叫什么、长什么样。
 *
 * 用户 2026-10-13：「AI 身份我觉得可以随时换 logo 和名称」。三态：
 *
 *  1. `name` 为空 → 回退默认名；`avatar` 为空 → 回退品牌图。
 *  2. `syncWithUserProfile` 打开 → 用「本机用户名首字母 + 确定性配色」画一个 initials
 *     头像，并跟随用户名。它是**优先级最高**的一态：开着的时候 name/avatar 都不参与渲染。
 *  3. 头像存成 dataURL。**必须限长**：它落在 `settings.json`，那是本应用的偏好文件，
 *     塞一张几 MB 的原图会连累同一文件里其它开关的读写。
 *
 * 这个模块必须**客户端与主进程都安全**（渲染与设置预览读同一份）；不碰 `node:fs`。
 */

/** 头像 dataURL 的长度上限。512 KB 足够一张 512×512 的 PNG，又不至于把偏好文件撑爆。 */
export const IDENTITY_AVATAR_MAX_CHARS = 512 * 1024;

export const IDENTITY_NAME_MAX_CHARS = 40;

/** 没设名字时的回退 —— 与本仓的品牌名一致。 */
export const DEFAULT_AGENT_NAME = "PI NEXT";

export interface AgentIdentity {
  name: string;
  /** dataURL，或空串（回退品牌图）。 */
  avatar: string;
  syncWithUserProfile: boolean;
}

export const EMPTY_IDENTITY: AgentIdentity = { name: "", avatar: "", syncWithUserProfile: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 坏值一律落回空态（不抛）：这个字段是手改得到的。 */
export function resolveIdentity(raw: unknown): AgentIdentity {
  if (!isRecord(raw)) return { ...EMPTY_IDENTITY };
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, IDENTITY_NAME_MAX_CHARS) : "";
  const avatar =
    typeof raw.avatar === "string" && raw.avatar.length <= IDENTITY_AVATAR_MAX_CHARS && isAvatarDataUrl(raw.avatar)
      ? raw.avatar
      : "";
  return { name, avatar, syncWithUserProfile: raw.syncWithUserProfile === true };
}

/** 只收图片 dataURL：`data:image/png;base64,…`。别的协议一律不当头像。 */
export function isAvatarDataUrl(value: string): boolean {
  return /^data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(value);
}

/** 校验一份待写入的头像，返回拒绝原因（null = 通过）。 */
export function avatarRejectionReason(value: string): "too-large" | "not-an-image" | null {
  if (!value) return null;
  if (value.length > IDENTITY_AVATAR_MAX_CHARS) return "too-large";
  if (!isAvatarDataUrl(value)) return "not-an-image";
  return null;
}

/**
 * 「同步用户资料」打开时用的 initials（最多两个字符）。
 *
 * 中日韩取整串的前两个字；拉丁取每个词的首字母。空名回退默认名的首字母 ——
 * 不画一个空圆圈。
 */
export function identityInitials(sourceName: string): string {
  const trimmed = sourceName.trim();
  if (!trimmed) return DEFAULT_AGENT_NAME.charAt(0);
  if (/[\u3000-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(trimmed)) {
    return [...trimmed].slice(0, 2).join("");
  }
  const words = trimmed.split(/[\s._-]+/).filter(Boolean);
  // 单个词（`yingjing`、`Ada`）取前两个字符，不做「一个字母」那种空落落的首字母 ——
  // 本机用户名几乎总是一个词，取一个字母看着像没画完。
  if (words.length <= 1) return [...(words[0] ?? trimmed)].slice(0, 2).join("").toUpperCase();
  const letters = words.slice(0, 2).map((word) => [...word][0] ?? "").join("");
  return (letters || trimmed.charAt(0)).toUpperCase();
}

/**
 * 确定性配色：同一个名字永远同一个色。9 个色相里挑一个，**不吃主题变量** ——
 * 它要画在一张头像底上，而那张底本身是定死的。
 */
const INITIALS_HUES = [8, 42, 96, 152, 190, 214, 258, 292, 336];

export function identityInitialsHue(sourceName: string): number {
  const key = sourceName.trim() || DEFAULT_AGENT_NAME;
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.codePointAt(0)!) % 100_000;
  return INITIALS_HUES[hash % INITIALS_HUES.length];
}

/** 头像那圈的底色（initials 用）。写死两个色，不跟主题走 —— 它是一张「头像」。 */
export function identityInitialsStyle(sourceName: string): { background: string; color: string } {
  const hue = identityInitialsHue(sourceName);
  return {
    background: `hsl(${hue} 62% 46%)`,
    color: "#ffffff",
  };
}

/**
 * 渲染用的一态：把三态收敛成「显示什么」。
 * `userName` 只在开了同步时参与；没开就只看 name/avatar。
 */
export interface ResolvedIdentity {
  /** 显示名。 */
  label: string;
  /** 图片地址（用户 dataURL）；null 表示回退品牌 logo 或用 initials。 */
  imageUrl: string | null;
  /** 图片为空时画什么。 */
  initials: string;
  /** 是否走 initials（决定要不要用 `identityInitialsStyle`）。 */
  initialsOnly: boolean;
}

export function resolveIdentityView(identity: AgentIdentity, userName: string): ResolvedIdentity {
  if (identity.syncWithUserProfile) {
    const source = userName.trim();
    if (source) {
      return { label: source, imageUrl: null, initials: identityInitials(source), initialsOnly: true };
    }
  }
  return {
    label: identity.name || DEFAULT_AGENT_NAME,
    imageUrl: identity.avatar || null,
    initials: identityInitials(identity.name || DEFAULT_AGENT_NAME),
    initialsOnly: false,
  };
}
