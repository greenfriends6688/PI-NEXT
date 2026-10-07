"use client";

/**
 * fork:zn-19 — 编辑主题（Zeno `ThemeSkinStudio.tsx`）。
 *
 * 两块：`主题设置` 与 `自定义 CSS`。11 个滑块**全部真的落到 CSS 变量上**
 * （`lib/theme-skins.ts` 的 `writeSkin`），没有只做 UI 的：焦点/缩放/压暗走壁纸层，
 * 阅读遮罩垫在消息列下，三个透明度决定侧栏/页面/卡片各让多少底透出来，模糊走
 * `backdrop-filter`，圆角写 `--radius-base`（`app/globals.css` 里所有圆角都由它派生），
 * 边框强度参与 `--border` 的混色比例。
 *
 * 保存是**整套替换**而不是逐项 patch：皮肤是一个 18 个字段的整体，逐项合并会让
 * 「取消」和「恢复默认」都要各自维护一份逆操作。
 *
 * fork:design-system —— 画板 D-07 帧 C「工作室第二屏」与画板 47 的外壳五段：
 * `.d-modal-head`（标题 + 关闭钮，页签不进头行）/ `.d-tabs` 页签行 /
 * `.d-modal-body` 内容行（左设置 1fr · 右预览 340px）/ 提示行（role=status，无消息时
 * 整行不存在）/ `.d-modal-foot` 动作行（删除 danger 仅编辑态 · 取消 / 恢复默认 / 保存 primary）。
 * 实时预览的迷你外壳是产品的功能性部件（圆角/玻璃/透明度旋钮只有画出整套
 * chrome 才看得出来），保留 `fork-skin-preview-*` 自有类 —— 登记同 Git 图泳道。
 *
 * fix:board47-css-tab（画板 47 帧 3 左半，2026-09-30）—— CSS 页签补三样：头内
 * `.d-badge warn`「高级」、文本域上方的 `.d-banner` 警告、动作行左槽在 CSS 页签
 * 变成「清空」。仍**缺**（需 lib/i18n 键或新能力，见报告）：画板那条 `.d-row`
 * 里的 `.d-btn sm`「格式化」与 `.d-badge bad` token 校验徽章。
 *
 * fix:board47-switch-vs-slider（**不改产品**，登记）—— 画板帧 1 把焦点环 / 玻璃模糊 /
 * 阅读遮罩画成 `.pw-switch`，产品这三个是滑块。复核结论：blur 是 0–40px、readingMask
 * 是 0–100% 的连续量（`lib/theme-skins.ts` 的 `SKIN_RANGES`），中间档是有意义的；
 * 「焦点环」产品根本没有这个旋钮（`ThemeSkin` 无该字段、CSS 也不发对应变量）。把连续
 * 量换成两档开关会删掉中间档，加一个开关则要动 `lib/theme-skins.ts` + CSS（超出文件
 * 范围）。所以本轮不动，判给画板：帧 1 这一处是画板滞后于实现。
 *
 * fork:v5-skin-mode（本轮唯一补上的一处）—— 材质模式（浅色 / 深色）的**档位表**
 * 进了 UI：`SKIN_MODE_VALUES`（`lib/theme-skins.ts`）原先在 `components/` 里
 * **零引用**（只有 lib 自己的 `parseThemeSkin` 在用），工作室的「明暗预览」是手写
 * `light` / `dark` 两个字面量的 —— 档位表与界面各一份。加第三档时解析认、调色板
 * `SKIN_MODE_PALETTE` 也给值，只有选择器看不见。现在这个选择器的档位直接来自
 * `SKIN_MODE_VALUES`（见 `SKIN_MODE_UI`），选值仍写进**已有的** `ThemeSkin.mode`
 * （`{ mode }` patch），不新增皮肤名、不新增皮肤字段。
 *
 * 本轮**撤回**的两条误读（不再实现，理由登记在案）：
 *   - 「圆角缩放 `1.0×`」：画板写的是倍率表述，产品用 `GEOMETRY_SLIDERS` 里
 *     `radius`（px）滑块接同一个槽位 —— **已登记的表达差异，不改**。
 *   - 「各面模式」：v5 画板里没有这一项（是从对齐清单误读出来的），不实现。
 *
 * D-07b 通用分节侧那处真缺口（「内置壁纸」画廊）在
 * `components/WallpaperSettings.tsx`，接的是同一个 `BuiltinWallpaperPicker`。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  SKIN_RANGES,
  resolveCssColorToHex,
  resolveSkinColors,
  SKIN_WALLPAPER_FIT_VALUES,
  type SkinColorKey,
  createSkinDraft,
  type SkinMode,
  type SkinWallpaperFit,
  type ThemeSkin,
} from "@/lib/theme-skins";
import { PwField, PwRadio, PwRange, PwSelectBox } from "./SettingsUi";
import { localCopy, type LocalCopy } from "./settings-disabled-reasons";
import type { Locale } from "@/lib/i18n/types";
import { BuiltinWallpaperPicker, builtinIdForWallpaperUrl } from "./BuiltinWallpaperPicker";
import { isBuiltinWallpaperId, paintingPath, type BuiltinWallpaperId } from "@/lib/wallpaper-builtin";
import { BUILTIN_SKIN_ID_PREFIX, BUILTIN_SKIN_LABEL_KEYS, isBuiltinSkinId } from "@/lib/builtin-skins";
import { SKIN_MODE_PALETTE, SKIN_MODE_VALUES } from "@/lib/theme-skins";

/** 滑块按画板 47 的分组落位：几何 / 不透明度与遮罩 / 壁纸（右列）。 */
const GEOMETRY_SLIDERS: Array<{ key: keyof typeof SKIN_RANGES; labelKey: string; unit: string }> = [
  { key: "radius", labelKey: "settings.skinRadius", unit: "px" },
  { key: "borderAlpha", labelKey: "settings.skinBorderAlpha", unit: "%" },
];

const OPACITY_SLIDERS: Array<{ key: keyof typeof SKIN_RANGES; labelKey: string; unit: string }> = [
  { key: "sidebarOpacity", labelKey: "settings.skinSidebarOpacity", unit: "%" },
  { key: "pageOpacity", labelKey: "settings.skinPageOpacity", unit: "%" },
  { key: "cardOpacity", labelKey: "settings.skinCardOpacity", unit: "%" },
  { key: "blur", labelKey: "settings.skinBlur", unit: "px" },
  { key: "readingMask", labelKey: "settings.skinReadingMask", unit: "%" },
];

const WALLPAPER_SLIDERS: Array<{ key: keyof typeof SKIN_RANGES; labelKey: string; unit: string }> = [
  { key: "focusX", labelKey: "settings.skinFocusX", unit: "%" },
  { key: "focusY", labelKey: "settings.skinFocusY", unit: "%" },
  { key: "wallpaperScale", labelKey: "settings.skinWallpaperScale", unit: "%" },
  { key: "wallpaperDim", labelKey: "settings.skinWallpaperDim", unit: "%" },
];

/* ---------------------------------------------------------------------------
 * fork:v5-skin-mode —— 材质模式（浅色 / 深色）的**档位只有一个来源**。
 *
 * 画板 D-07 帧 C「明暗预览」那一行是 `.d-seg` 的两档（`sun` / `moon` 图标 + 文案），
 * 产品那一行一直是对的；缺的是**档位表没有进界面**：`SKIN_MODE_VALUES` 只被
 * `lib/theme-skins.ts` 自己的 `parseThemeSkin` 读过（`grep -rn SKIN_MODE_VALUES
 * components/` 为空），界面这边手写 `light` / `dark` 两个字面量。后果不是今天，
 * 是加第三档的那天：解析认、调色板 `SKIN_MODE_PALETTE` 也给值，只有选择器看不见
 * （铁律三：一个值 / 一个集合只有一个来源）。
 *
 * 这里的写法让「加档位」只改一处：`SKIN_MODE_UI` 的类型是 `Record<SkinMode, …>`
 * —— lib 里加一档而这里没给图标与文案，`tsc` 直接报错，而不是让那一档在界面上
 * 悄悄消失。反过来（这里写了 lib 没有的档）也进不来，因为档位从 `SKIN_MODE_VALUES`
 * 枚举，不从这里枚举。
 * ----------------------------------------------------------------------- */

const SKIN_MODE_UI: Record<SkinMode, { icon: string; labelKey: string }> = {
  light: { icon: "sun", labelKey: "settings.skinModeLight" },
  dark: { icon: "moon", labelKey: "settings.skinModeDark" },
};

/** 档位顺序 = `lib/theme-skins.ts` 的顺序，不再在界面里另排一遍。 */
const SKIN_MODE_OPTIONS = SKIN_MODE_VALUES.map((mode) => ({
  value: mode,
  icon: SKIN_MODE_UI[mode].icon,
  labelKey: SKIN_MODE_UI[mode].labelKey,
}));

const COLOR_FIELDS: Array<{ key: keyof ThemeSkin; labelKey: string }> = [
  { key: "accent", labelKey: "settings.skinAccent" },
  { key: "background", labelKey: "settings.skinBackground" },
  { key: "panel", labelKey: "settings.skinPanel" },
  { key: "text", labelKey: "settings.skinText" },
];

/** `<input type="color">` 只认 `#rrggbb`；基色可能是 oklch 或 color-mix，统一转一道。 */
function toColorInputValue(value: string, fallback: string): string {
  return resolveCssColorToHex(value, fallback) || fallback;
}

/* fork:skin-builtin-identity — 内置皮肤的名字与画作**由 id 决定**，不是由可变字段。
 *
 * 用户实拍（2026-10-07）：「为啥我编辑蔡徐坤这个内置主题的时候，这里面会出现章若楠
 * 的内置壁纸啊……然后还有那个名称那里是空的」。两半是同一个错：把内置皮肤当成普通
 * 皮肤读。
 *
 *   1. 名称：内置皮肤的名字在目录里（`BUILTIN_SKIN_LABEL_KEYS` → i18n 键），
 *      `skin.name` 是空串（`lib/builtin-skins.ts` 用
 *      `createSkinDraft(builtinSkinId(id), "", …)` 造）。所以「基本信息 → 名称」空白。
 *   2. 壁纸：内置皮肤的 `wallpaper` 是 `paintingPath(id)`，但 `parseThemeSkin` 只接受
 *      data URL —— 用户保存过内置皮肤的覆盖后重启，路径被解析成 null，画作就丢了。
 *      预览没有壁纸层、画廊也没有选中态，透过半透明的弹窗露出底下主题色板默认的
 *      **章若楠**（`PALETTE_PAINTING` 两张画都指它）。这就是「壁纸串了」。
 *
 * 两处都从 `skin.id` 补回，且各自只有一个来源：名字查 `BUILTIN_SKIN_LABEL_KEYS`，
 * 画作把 `builtin-<paintingId>` 前缀剥掉再用 `isBuiltinWallpaperId` 验一次。
 */

/**
 * 内置皮肤当前用的是哪张内置画；null = 自定义图或非内置皮肤。
 *
 * 优先用户显式挑的那张（内置皮肤也能被改成另一张内置画），其次才按 id 回退 ——
 * `wallpaper` 为空只可能是「路径被解析丢了」，因为用户主动清空是同一个 null，
 * 分不开，所以这里补回的是内置皮肤的**固有身份**。
 */
export function builtinWallpaperIdForSkin(
  skin: Pick<ThemeSkin, "id" | "wallpaper">,
): BuiltinWallpaperId | null {
  const chosen = builtinIdForWallpaperUrl(skin.wallpaper);
  if (chosen) return chosen;
  if (skin.wallpaper) return null;
  if (!isBuiltinSkinId(skin.id)) return null;
  const derived = skin.id.slice(BUILTIN_SKIN_ID_PREFIX.length);
  return isBuiltinWallpaperId(derived) ? derived : null;
}

/** 目录里的显示名；`skin.name` 为空时按 id 查表（唯一来源，不另造映射）。 */
export function builtinSkinDisplayName(
  skin: Pick<ThemeSkin, "id" | "name">,
  t: (key: string) => string,
): string {
  const labelKey = BUILTIN_SKIN_LABEL_KEYS[skin.id];
  return skin.name || (labelKey ? t(labelKey) : "");
}

/** 打开编辑器时的初始草稿：把内置皮肤丢了的名字与画作补回来。 */
function hydrateSkin(skin: ThemeSkin, t: (key: string) => string): ThemeSkin {
  const name = builtinSkinDisplayName(skin, t);
  const paintingId = builtinWallpaperIdForSkin(skin);
  const wallpaper = skin.wallpaper ?? (paintingId ? paintingPath(paintingId) : null);
  return { ...skin, name, wallpaper };
}

/** fork:v5-landing-frame · D-07 帧 C —— 四色那一段的字段说明（板面原文，缺键登记）。 */
const SKIN_COLOR_HINT: LocalCopy = {
  en: "The board only writes hexadecimal placeholders; the real values come from the role tokens in tokens.css, and a skin overrides just these four variables.",
  "zh-CN": "画板上只写十六进制字符串占位；真值由 tokens.css 的角色令牌给出，皮肤只覆盖这四个变量。",
  "zh-TW": "畫板上只寫十六進位字串佔位；真值由 tokens.css 的角色權杖給出，皮膚只覆蓋這四個變數。",
};

/** 未覆盖时文本框里的占位（板面写的是「留空表示继承默认皮肤」）。 */
const SKIN_HEX_PLACEHOLDER = "#rrggbb / inherit";

/* fork:v5-landing-frame · D-07 帧 C —— 「几何与不透明度」里壁纸那一行的说明，以及
   「自定义 CSS」那个字段的标题与字段说明。板面原文，语言包里没有（`lib/i18n/**` 不在
   本轮文件范围），走本地表。 */
const SKIN_WALLPAPER_HINT: LocalCopy = {
  en: "Anything over 3 MB is rejected — the skin is exported as one JSON file and the image goes in with it.",
  "zh-CN": "超过 3 MB 会被拒 —— 皮肤要整份导出成 JSON，图片一并进去。",
  "zh-TW": "超過 3 MB 會被拒 —— 皮膚要整份匯出成 JSON，圖片一併進去。",
};

const SKIN_CSS_FIELD_TITLE: LocalCopy = {
  en: "Appended to the end of the stylesheet",
  "zh-CN": "追加到样式表末尾",
  "zh-TW": "追加到樣式表末尾",
};

const SKIN_CSS_FIELD_HINT: LocalCopy = {
  en: "It can override any rule, including my own — so a typo does not throw an error, the interface just “looks wrong”. That is what the restore button below is for.",
  "zh-CN": "能覆盖任何规则，也包括我自己 —— 所以写错时面板不会报错，只会「看起来不对」，这里给一个还原按钮。",
  "zh-TW": "能覆蓋任何規則，也包括我自己 —— 所以寫錯時面板不會報錯，只會「看起來不對」，這裡給一個還原按鈕。",
};

/**
 * 一个色字段：`.d-field`（`.d-field-t` + `.d-row`）。
 *
 * fork:v5-landing-frame · D-07 帧 C —— 板面那一格里除了取色器还有一只
 * `.d-input.d-mono` 的十六进制文本框，并写明「留空表示继承默认皮肤」。产品此前只有
 * 取色器，既不能手输，也没有一处说清「留空 = 继承」。
 *
 * 文本框**失焦 / 回车才提交**：每次按键都把半截 `#f7f` 当值提交会把皮肤打坏。
 * 空串 = 清掉这一档的覆盖（回到继承），合法六位 = 写入变体，其余 = 视为还在打字，
 * 回到当前真值。判据是纯函数，导出给单测。
 */
export function skinHexToValue(raw: string): string | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const hex = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : undefined;
}

function SkinColorField({
  label,
  value,
  effective,
  fallback,
  onChange,
}: {
  label: string;
  /** 当前模式的变体值（空串 = 未覆盖，继承）。 */
  value: string;
  /** 继承链算出来的实际值（变体 → 共享 → 该模式调色板）。 */
  effective: string;
  fallback: string;
  onChange: (next: string) => void;
}) {
  const isMobile = useIsMobile();
  const inherited = !value;
  const resolved = toColorInputValue(effective, fallback);
  const [text, setText] = useState(inherited ? "" : resolved);
  useEffect(() => {
    setText(inherited ? "" : resolved);
  }, [inherited, resolved]);

  const commit = () => {
    const next = skinHexToValue(text);
    if (next === undefined) {
      setText(inherited ? "" : resolved);
      return;
    }
    onChange(next ?? "");
  };

  return (
    <div className={isMobile ? "m-fieldrow" : "d-field"}>
      <span className={isMobile ? "m-t-sm" : "d-field-t"}>{label}</span>
      <span className={isMobile ? "m-row-body" : "d-row"}>
        <input
          type="color"
          className="d-swatch"
          value={resolved}
          data-inherited={inherited ? "true" : undefined}
          onChange={(event) => {
            setText(event.target.value);
            onChange(event.target.value);
          }}
          aria-label={label}
        />
        <input
          type="text"
          className="d-input d-mono"
          value={text}
          placeholder={inherited ? SKIN_HEX_PLACEHOLDER : undefined}
          spellCheck={false}
          maxLength={7}
          aria-label={label}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
        />
      </span>
    </div>
  );
}

/** fork:v5-landing-frame · D-07 帧 C「几何与不透明度」的两个字段标题下那句判据。
    板面上只有「组件圆角」与「玻璃模糊」两格带说明（其余两格板面没画），语言包里没有，
    走本地表。 */
const SKIN_FIELD_HINTS: Partial<Record<keyof typeof SKIN_RANGES, LocalCopy>> = {
  radius: {
    en: "One value drives every corner role (xs / sm / md / lg / xl) — not one control at a time.",
    "zh-CN": "一个值改所有圆角角色（xs / sm / md / lg / xl），不是逐个控件调。",
    "zh-TW": "一個值改所有圓角角色（xs / sm / md / lg / xl），不是逐個控制項調。",
  },
  blur: {
    en: "The top bar and the popovers share this one level; at 0 it falls back to a solid colour and the top bar gets visibly heavier.",
    "zh-CN": "顶栏与浮层用同一档；调到 0 会退回实色，这时顶栏会「变重」。",
    "zh-TW": "頂欄與浮層用同一檔；調到 0 會退回實色，這時頂欄會「變重」。",
  },
};

function SkinSlider({ entry, draft, patch, t, locale }: {
  entry: { key: keyof typeof SKIN_RANGES; labelKey: string; unit: string };
  draft: ThemeSkin;
  patch: (next: Partial<ThemeSkin>) => void;
  t: (key: string) => string;
  locale: Locale;
}) {
  const isMobile = useIsMobile();
  const range = SKIN_RANGES[entry.key];
  const value = draft[entry.key] as number;
  const id = `skin-slider-${entry.key}`;
  const hint = SKIN_FIELD_HINTS[entry.key];
  // fork:v5-landing-frame · D-07 帧 C —— 滑块那一行在板面上是 `.d-field`
  // （`.d-field-t` 标题 + 可选的一句 `.d-t-xs.d-t-faint` + `.d-row` 里
  // `.d-slider` 与 `.d-t-xs.d-mono` 读数），不是 `.d-set-row`：这一块是「参数表」，
  // 每一格自带标题与一句判据，行形态留给别的块。此前发的是 `.d-set-row`，板面没有。
  return (
    <div className={isMobile ? "m-fieldrow" : "d-field"}>
      <span className={isMobile ? "m-t-sm" : "d-field-t"}>
        <label htmlFor={id}>{t(entry.labelKey)}</label>
      </span>
      {hint ? (
        <span className={isMobile ? "m-t-xs m-t-faint" : "d-t-xs d-t-faint"}>
          {localCopy(hint, locale)}
        </span>
      ) : null}
      <span className={isMobile ? "m-row-body" : "d-row"}>
        <PwRange
          id={id}
          value={value}
          displayValue={`${value}${entry.unit}`}
          min={range.min}
          max={range.max}
          step={range.step}
          ariaLabel={t(entry.labelKey)}
          onChange={(next) => patch({ [entry.key]: next } as Partial<ThemeSkin>)}
        />
      </span>
    </div>
  );
}

export function ThemeSkinStudio({
  skin,
  isNew,
  onCancel,
  onSave,
  onDelete,
}: {
  skin: ThemeSkin;
  isNew: boolean;
  onCancel: () => void;
  onSave: (skin: ThemeSkin) => void;
  onDelete?: (id: string) => void;
}) {
  const { locale, t } = useI18n();
  const isMobile = useIsMobile();
  // fork:skin-builtin-identity — 初始草稿先补齐：内置皮肤的名字/画作不在 `skin` 里。
  const [draft, setDraft] = useState<ThemeSkin>(() => hydrateSkin(skin, t));
  const [tab, setTab] = useState<"settings" | "css">("settings");
  const [previewMode, setPreviewMode] = useState<SkinMode>(skin.mode);
  const [message, setMessage] = useState("");
  // fork:zn-19-inline 回退 — 编辑走**弹窗**（用户要求）：内联会把设置面板撑得很长，
  // 而且卡片条下方那块空间本来就窄。回到 dialog + 焦点约束。
  const { dialogRef, dialogProps } = useDialogA11y({ open: true, onClose: onCancel });

  useEffect(() => { setDraft(hydrateSkin(skin, t)); }, [skin, t]);
  useEffect(() => { setPreviewMode(skin.mode); }, [skin.mode]);

  // 打开后把焦点放到名称上（弹窗里也顺手）。
  const nameRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    nameRef.current?.focus({ preventScroll: true });
  }, [skin.id, isNew]);

  const patch = (next: Partial<ThemeSkin>) => setDraft((current) => ({ ...current, ...next }));

  /** CSS 页签动作行「清空」的显隐条件：只有真的有内容时才有东西可清。 */
  const hasCustomCss = draft.customCss.trim().length > 0;

  /** 写当前模式变体的一个颜色；空串 = 清掉覆盖，回到共享值。 */
  const patchVariantColor = (key: SkinColorKey, value: string) => {
    setDraft((current) => ({
      ...current,
      [previewMode]: { ...current[previewMode], [key]: value },
    }));
  };

  const pickWallpaper = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      // 上限 3MB：皮肤会被导出/导入成 JSON，data URL 会把文件撑大 1/3。
      if (file.size > 3_000_000) {
        setMessage(t("settings.skinWallpaperTooLarge"));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          patch({ wallpaper: reader.result });
          setMessage("");
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  /* 预览用同一套派生公式，但**只作用在预览盒子里**：把 `draft` 的派生值算成
     inline style，而不是写 `<html>` 变量 —— 否则「编辑中」的皮肤会当场改掉整个应用，
     用户按「取消」时来不及回滚。 */
  const previewStyle = useMemo(() => {
    // fork:zn-19-variant — 预览按**当前选中的模式**取色：变体 → 共享 → 该模式调色板。
    // 之前这里直接用 draft 的共享基色，所以点「深色」预览纹丝不动（开关是死的）。
    const palette = SKIN_MODE_PALETTE[previewMode];
    const resolved = resolveSkinColors(draft, previewMode);
    const bg = resolved.background || palette.background;
    const pn = resolved.panel || palette.panel;
    const ac = resolved.accent || palette.accent;
    const tx = resolved.text || palette.text;
    return {
      background: bg,
      color: tx,
      "--preview-panel": `color-mix(in srgb, ${pn} ${draft.cardOpacity}%, transparent)`,
      "--preview-sidebar": `color-mix(in srgb, ${pn} ${draft.sidebarOpacity}%, transparent)`,
      "--preview-page": `color-mix(in srgb, ${bg} ${draft.pageOpacity}%, transparent)`,
      // fork:skin-preview-reading-mask — 真机 `.chat-slot::before` 的方向性阅读遮罩
      // 照抄到预览里（102deg，三个色标 100% / 86% / 42%，基色换成预览的 `bg`）。
      // 整条渐变在 JS 里算成一个变量，CSS 只写 `background: var(--preview-reading)`，
      // 与真机只差一个变量名 —— 两个透明度滑块终于有对应的层可看。
      "--preview-reading": `linear-gradient(102deg, color-mix(in srgb, ${bg} ${draft.readingMask}%, transparent) 0%, color-mix(in srgb, ${bg} calc(${draft.readingMask}% * 0.86), transparent) 52%, color-mix(in srgb, ${bg} calc(${draft.readingMask}% * 0.42), transparent) 100%)`,
      "--preview-border": `color-mix(in srgb, ${tx} ${draft.borderAlpha}%, transparent)`,
      "--preview-radius": `${draft.radius}px`,
      "--preview-blur": `${draft.blur}px`,
      "--preview-accent": ac,
      "--preview-text-muted": `color-mix(in srgb, ${tx} 62%, ${bg})`,
    } as React.CSSProperties;
  }, [draft, previewMode]);

  // fork:ui-skin-modal-portal — **必须挂到 body**：设置面板那层有 `overflow: hidden`，
  // 而皮肤接管时它又带 `backdrop-filter` —— 后者会让 `position: fixed` 相对面板定位，
  // 于是弹窗上下两端被面板裁掉（标题和保存按钮都露不全）。portal 出去就与面板无关了。
  const modal = (
    <div
      ref={dialogRef}
      {...dialogProps}
      className="d-modal is-open fork-skin-scrim"
      onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}
    >
      {/* 画板 D-07 帧 C「工作室」是设置里的第二屏；产品这里是 portal 弹窗（v5 无工作室
          弹窗画板），所以用画板弹窗原子 `.d-modal-box`（900×720 的旧尺寸由 board.css
          的 `.pw-modal` 提供，已随换皮移除 —— 见报告）。 */}
      <div
        className="d-modal-box wide fork-skin-modal"
        aria-label={isNew ? t("settings.skinNewTitle") : t("settings.skinEditTitle")}
        /* fork:pwa-skin-frame —— 900×720 的画板 47 尺寸从 inline 搬进类（值照抄，
           桌面渲染零变化）：手机档要把它从「居中 900px 对话框」改成贴底全屏
           sheet，而 inline 样式 CSS 压不过。 */
      >
        <div className="d-modal-head">
          {isNew ? t("settings.skinNewTitle") : t("settings.skinEditTitle")}
          <span className="d-grow" aria-hidden="true" />
          {/* fix:board47-css-badge（画板 47 帧 3）—— 「自定义 CSS」这一页在头里挂一枚
              `.pw-badge warn`「高级」：它是整个工作室里唯一能直接把样式表改坏的页面，
              头是「这是哪个东西」那一行，警示放在这里才不会被滚出视野。文案复用
              `models.advancedTitle`（三语都是「高级 / Advanced / 進階」）—— i18n 键在
              lib/i18n/messages/*，本轮文件范围外，不新造键（键名串味登记在报告里）。 */}
          {tab === "css" ? (
            <span className="d-badge warn">{t("models.advancedTitle")}</span>
          ) : null}
          <button type="button" className="d-iconbtn fork-pwa-hit" aria-label={t("i18n.close")} title={t("i18n.close")} onClick={onCancel}>
            <i data-ico="x" data-size="14" aria-hidden="true" />
          </button>
        </div>

        <div role="tablist" className="d-tabs">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "settings"}
            className={`d-tab${tab === "settings" ? " is-on" : ""}`}
            onClick={() => setTab("settings")}
          >
            {t("settings.skinTabSettings")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "css"}
            className={`d-tab${tab === "css" ? " is-on" : ""}`}
            onClick={() => setTab("css")}
          >
            {t("settings.skinTabCss")}
          </button>
        </div>

        {tab === "settings" ? (
          // fix:skin-preview-left（用户裁定 2026-09-30）—— 实时预览挪到**左列**。
          // 画板 47 帧 1 画的是「左设置 1fr · 右预览 340px」，用户明确要求反过来
          // （「为啥把预览放在右边了啊，应该放到左边啊」）。DOM 顺序不动，用 grid 的
          // `order` 把预览列排到第一格，两个子块各写一个 order（见下）。
          <div
            className="d-modal-body fork-pwa-skin-body"
            /* fork:pwa-skin-body —— 「左设置 1fr · 右预览 340px」的分栏从 inline
               搬进类（值逐条照抄，桌面渲染零变化），手机档才能把它收成单列：
               inline 样式是 CSS 压不过的。 */
          >
            {/* 右（原左）：设置（画板 47 帧 1：基本信息 / 四色 / 几何 / 不透明度与遮罩） */}
            <div className="fork-pwa-skin-col">
              <div className="d-set-sec-t">{t("settings.skinSectionBasic")}</div>
              <PwField label={t("settings.skinName")} control={
                <input
                  ref={nameRef}
                  type="text"
                  className="d-input"
                  style={{ minWidth: 0, width: 220 }}
                  maxLength={60}
                  value={draft.name}
                  onChange={(event) => patch({ name: event.target.value })}
                  aria-label={t("settings.skinName")}
                />
              } />
              {/* fork:v5-skin-mode —— 画板 D-07 帧 C 的「明暗预览」：`.d-seg` 两档
                  （sun / moon）。档位从 `SKIN_MODE_VALUES` 枚举、图标与文案按档位查
                  `SKIN_MODE_UI`，选值写进**已有的** `ThemeSkin.mode`（也就是编辑器
                  默认打开哪套变体；运行时仍按应用当前明暗取，`writeSkin` 不看它）。 */}
              <PwField label={t("settings.skinPreviewMode")} control={
                <PwRadio
                  value={previewMode}
                  ariaLabel={t("settings.skinPreviewMode")}
                  options={SKIN_MODE_OPTIONS.map((option) => ({
                    value: option.value,
                    icon: option.icon,
                    label: t(option.labelKey),
                  }))}
                  onChange={(mode) => { setPreviewMode(mode); patch({ mode }); }}
                />
              } />

              <div className="d-set-sec-t">
                {t("settings.skinSectionColors")}
              </div>
              {/* fork:zn-19-variant — 这四个色输入编辑的是**当前模式的变体**（Zeno 的
                  `updateVariantColor`）。变体为空时显示继承来的共享值。
                  fork:v5-landing-frame · D-07 帧 C —— 板面原文是 `.d-grid2` 里四个
                  `.d-field`：`.d-field-t`（标题）+ `.d-row`（`.d-swatch` 色块 +
                  **`.d-input.d-mono` 十六进制文本框**），并写明「留空表示继承默认皮肤」。
                  产品此前只有 `.d-set-row` + 取色器，既不能手输十六进制，也没有一个地方
                  说清「留空 = 继承」；现在两样都补上（留空即清掉这一档的覆盖）。 */}
              <div className={isMobile ? "m-grid2" : "d-grid2"}>
                {COLOR_FIELDS.map((field) => {
                  const key = field.key as SkinColorKey;
                  const variantValue = draft[previewMode][key];
                  const effective = resolveSkinColors(draft, previewMode)[key];
                  return (
                    <SkinColorField
                      key={String(field.key)}
                      label={t(field.labelKey)}
                      value={variantValue}
                      effective={effective}
                      fallback={SKIN_MODE_PALETTE[previewMode][key]}
                      onChange={(hex) => patchVariantColor(key, hex)}
                    />
                  );
                })}
              </div>
              <div className={isMobile ? "m-t-xs m-t-faint" : "d-t-xs d-t-faint"}>
                {localCopy(SKIN_COLOR_HINT, locale)}
              </div>

              <div className="d-set-sec-t">
                {t("settings.skinSectionGeometry")}
              </div>
              {GEOMETRY_SLIDERS.map((entry) => (
                <SkinSlider key={entry.key} entry={entry} draft={draft} patch={patch} t={t} locale={locale} />
              ))}

              <div className="d-set-sec-t">
                {t("settings.skinSectionOpacity")}
              </div>
              {OPACITY_SLIDERS.map((entry) => (
                <SkinSlider key={entry.key} entry={entry} draft={draft} patch={patch} t={t} locale={locale} />
              ))}

            </div>

            {/* 左（原右）：预览列（画板 47 的分栏语义保留，只是换到左侧 —— 发丝线改成右边线） */}
            <div className="fork-pwa-skin-col fork-pwa-skin-preview">
              <div className="d-set-sec-t">{t("settings.skinSectionPreview")}</div>

              {/* 迷你外壳：侧栏 + 会话列 + 作曲器（fork-skin-preview-* 是功能性预览，
                  自有类保留 —— 圆角/玻璃/透明度/边框只在这三块上同时出现时才看得出来）。 */}
              <div className="fork-skin-preview" style={previewStyle} data-mode={previewMode}>
                {draft.wallpaper ? (
                  <div
                    className="fork-skin-preview-wallpaper"
                    style={{
                      backgroundImage: `url(${draft.wallpaper})`,
                      backgroundPosition: `${draft.focusX}% ${draft.focusY}%`,
                      backgroundSize: `${draft.wallpaperScale}%`,
                    }}
                  />
                ) : null}
                <div
                  className="fork-skin-preview-mask"
                  style={{
                    background: `color-mix(in srgb, ${previewStyle.background as string} ${draft.wallpaperDim}%, transparent)`,
                  }}
                />
                {/* fork:skin-preview-reading-mask — 层序与真机一致，用户在预览里看到的
                    就是保存后的样子：壁纸 → 压暗层 → **页面层（`--preview-page`）** →
                    **阅读遮罩层（`--preview-reading`）** → chrome。此前 `--preview-page`
                    是 `.fork-skin-preview` 自己的 background（还被 inline 的基色盖住），
                    壁纸作为子元素整块压在上面 —— 「页面透明度」拖了没反应；阅读遮罩在预览
                    里没有对应层 —— 「会话阅读遮罩」永远没有反馈（用户实拍「点了没啥反应」）。 */}
                <div className="fork-skin-preview-page" />
                <div className="fork-skin-preview-reading" />
                <div className="fork-skin-preview-shell">
                  <div className="fork-skin-preview-sidebar">
                    <span className="fork-skin-preview-brand" />
                    <span className="fork-skin-preview-nav" data-active="true" />
                    <span className="fork-skin-preview-nav" />
                    <span className="fork-skin-preview-nav" />
                  </div>
                  <div className="fork-skin-preview-main">
                    <div className="fork-skin-preview-thread">
                      <span className="fork-skin-preview-line" style={{ width: "82%" }} />
                      <span className="fork-skin-preview-line" style={{ width: "64%" }} />
                      <span className="fork-skin-preview-line" style={{ width: "74%" }} />
                    </div>
                    <div className="fork-skin-preview-composer" />
                  </div>
                </div>
              </div>

              <div className="d-set-sec-t">
                {t("settings.skinSectionWallpaper")}
              </div>
              <PwField
                label={t("settings.skinSectionWallpaper")}
                hint={localCopy(SKIN_WALLPAPER_HINT, locale)}
                control={
                  <>
                    <PwSelectBox
                      value={draft.wallpaperFit}
                      ariaLabel={t("settings.skinWallpaperFit")}
                      options={SKIN_WALLPAPER_FIT_VALUES.map((fit) => ({ value: fit, label: t(`settings.skinFit_${fit}`) }))}
                      onChange={(fit) => patch({ wallpaperFit: fit as SkinWallpaperFit })}
                    />
                    <button type="button" className={isMobile ? "m-btn sm" : "d-btn sm"} onClick={pickWallpaper}>
                      <i data-ico="image" data-size="13" aria-hidden="true" />
                      {t("settings.skinChooseWallpaper")}
                    </button>
                  </>
                }
              />
              {draft.wallpaper ? (
                <PwField
                  label={t("settings.skinRemoveWallpaper")}
                  control={
                    <button
                      type="button"
                      className={isMobile ? "m-btn sm ghost" : "d-btn sm ghost"}
                      onClick={() => patch({ wallpaper: null })}
                    >
                      {t("settings.skinRemoveWallpaper")}
                    </button>
                  }
                />
              ) : null}
              {WALLPAPER_SLIDERS.map((entry) => (
                <SkinSlider key={entry.key} entry={entry} draft={draft} patch={patch} t={t} locale={locale} />
              ))}

              {/* fork:zn-19-merge — 内置画作也能在这里直接挑：原来只有设置里的「壁纸」
                  区块能选，进工作室配皮肤时挑不到，得退出去再进来。 */}
              <BuiltinWallpaperPicker
                labelKey="settings.skinBuiltinWallpaper"
                activeId={builtinWallpaperIdForSkin(draft)}
                onPick={(id) => patch({ wallpaper: paintingPath(id) })}
              />
            </div>
          </div>
        ) : (
          <div className="d-modal-body fork-pwa-skin-css">
            {/* fix:board47-css-warn（画板 47 帧 3 左半）—— 文本域之上常驻一条 `.pw-alert`：
                这一页的规则会覆盖皮肤设置，写错能让界面没法用，所以警告必须**先于**
                编辑器出现，而不是等到保存失败。原先是 `.sub` 一行灰字（`.pw-sbody>p.sub`
                的样式），在弹窗里既不显眼也没有图标，等于把一句警告写成了脚注。
                文案沿用 `settings.skinCustomCssHint`（「可以覆盖任何规则 / 仅作用于本机」），
                画板那句「写错可能导致界面不可用，但可以随时重置为默认」需要新 i18n 键，
                见报告。 */}
            <div className="d-banner warn">
              <i data-ico="triangle-alert" data-size="14" aria-hidden="true" />
              <span className="d-grow">{t("settings.skinCustomCssHint")}</span>
            </div>
            {/* fork:v5-landing-frame · D-07 帧 C「自定义 CSS」—— 板面原文是一个 `.d-field`：
                `.d-field-t`（标题「追加到样式表末尾」）+ `.d-textarea` + 字段说明那句
                「能覆盖任何规则，也包括我自己…所以写错时面板不会报错，只会看起来不对」。
                产品此前只有一条横幅 + 裸文本域。 */}
            <div className={isMobile ? "m-fieldrow" : "d-field"}>
              <span className={isMobile ? "m-t-sm" : "d-field-t"}>
                {localCopy(SKIN_CSS_FIELD_TITLE, locale)}
              </span>
              <textarea
                className="d-textarea"
                style={{ minHeight: 0, flex: 1 }}
                spellCheck={false}
                value={draft.customCss}
                onChange={(event) => patch({ customCss: event.target.value })}
                placeholder={".sidebar-container { letter-spacing: 0.01em; }"}
                aria-label={localCopy(SKIN_CSS_FIELD_TITLE, locale)}
              />
              <span className={isMobile ? "m-t-xs m-t-faint" : "d-t-xs d-t-faint"}>
                {localCopy(SKIN_CSS_FIELD_HINT, locale)}
              </span>
            </div>
          </div>
        )}

        {/* 提示行：画板 47 —— 无消息时整行不存在。 */}
        {message ? (
          <div role="status" className="d-banner" style={{ margin: "0 var(--s4)" }}>
            <i data-ico="triangle-alert" data-size="14" aria-hidden="true" />
            <span className="grow">{message}</span>
          </div>
        ) : null}

        <footer className="d-modal-foot fork-pwa-skin-foot">
          {/* fix:board47-css-clear（画板 47 帧 3 左半）—— 动作行的**左槽按页签换语义**，
              不并排两枚 danger：CSS 页签是「清空」（清掉这份自定义规则，换一个出口），
              主题设置页签是「删除」（删掉这套皮肤）。两枚红按钮并排时用户分不清点的是
              「删这段 CSS」还是「删整套皮肤」—— 而这两件事的代价差三个数量级。
              「清空」按内容显隐：画板自己就是这么定这个槽的（帧 2 的新建态左下**没有**
              「删除」——「还没有一个能删的东西」）。空编辑器时留一枚点不动的红按钮，
              既是不留死控件，也是它自己的那条约定。 */}
          {tab === "css"
            ? (hasCustomCss ? (
              <button type="button" className="d-btn danger" onClick={() => patch({ customCss: "" })}>
                {t("tabs.clearRecent")}
              </button>
            ) : null)
            : onDelete && !isNew ? (
              <button type="button" className="d-btn danger" onClick={() => onDelete(draft.id)}>
                {t("i18n.delete")}
              </button>
            ) : null}
          <span className="d-grow" aria-hidden="true" />
          <button type="button" className="d-btn ghost" onClick={onCancel}>
            {t("i18n.cancel")}
          </button>
          <button type="button" className="d-btn" onClick={() => setDraft(createSkinDraft(draft.id, draft.name, draft.mode))}>
            {t("settings.skinReset")}
          </button>
          <button type="button" className="d-btn primary" onClick={() => onSave(draft)}>
            {t("i18n.save")}
          </button>
        </footer>
      </div>
    </div>
  );

  return typeof document === "undefined" ? modal : createPortal(modal, document.body);
}
