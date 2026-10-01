"use client";

/**
 * fork:input-limits — pi-ai 的 `ModelInputLimits` / `ModelPromptCache` 输入区。
 *
 * 这两个是 pi-ai 的**原生字段**（`@earendil-works/pi-ai/dist/types.d.ts`：
 * `ModelInputLimits` / `ModelImageInputLimits` / `ModelImageResizeOptions` /
 * `ModelPromptCache`，`Model` 上是 `inputLimits?` 与 `promptCache?`），但本 fork 的
 * `ModelEntry` 一直**没声明**它们，`models.json` 编辑器也就没有对应入口 ——
 * 多模态上限、图片 resize 策略、提示词缓存时长只能手改 JSON。
 *
 * **上游也缺**：`pi参考项目/pi-web-main`（agegr/main HEAD）全树
 * `grep -rn "inputLimits\|promptCache"` 零命中，所以这条不是「只补类型」，类型与 UI 一起补。
 *
 * ## 范围按 pi 自己的 schema 抄，不自己发明
 * pi 在 `model-config.js:121-136` 用 Typebox 校验 models.json：
 *   - `inputLimits.maxRequestBytes` / `images.maxPerMessage` / `images.maxPerRequest`
 *     / `images.resize.maxWidth|maxHeight|maxBytes` → 整数 ≥ 1
 *   - `images.resize.jpegQuality` → 整数 1..100
 *   - `promptCache.short` / `.long` → **秒**，> 0
 * 所以这里逐条对齐：越界一律**夹回合法值或丢弃**，绝不写出一个让 pi 读不动的 models.json。
 *
 * ## 清空即删键（不是写 0）
 * 把一个输入框清空时，这里把**整条路径**删掉，并把因此变空的父对象（`images` / `resize` /
 * 整个 `inputLimits`）一并剪掉 —— 照 A1 的教训：models.json 里不该攒下一堆空壳对象。
 */
import type { ModelImageInputLimits, ModelImageResizeOptions, ModelInputLimits, ModelPromptCache } from "@earendil-works/pi-ai";
import { useI18n } from "@/hooks/useI18n";
import { ConfigField, ConfigSectionTitle } from "./SettingsUi";

/** 输入框里的字符串 → 合法值。清空 / 非数字 / 越界 → undefined（= 删掉这个键）。 */
export function parseLimitInput(raw: string, bounds: { min: number; max?: number }): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  const rounded = Math.round(parsed);
  if (rounded < bounds.min) return undefined;
  if (bounds.max !== undefined && rounded > bounds.max) return undefined;
  return rounded;
}

/** 逐条读嵌套值；任何一层缺了就是 undefined（不猜默认值）。 */
export function readInputLimit(limits: ModelInputLimits | undefined, path: InputLimitPath): number | undefined {
  if (!limits) return undefined;
  if (path === "maxRequestBytes") return limits.maxRequestBytes;
  const images: ModelImageInputLimits | undefined = limits.images;
  if (!images) return undefined;
  if (path === "images.maxPerMessage") return images.maxPerMessage;
  if (path === "images.maxPerRequest") return images.maxPerRequest;
  const resize: ModelImageResizeOptions | undefined = images.resize;
  return resize?.[path.slice("images.resize.".length) as keyof ModelImageResizeOptions];
}

export type InputLimitPath =
  | "maxRequestBytes"
  | "images.maxPerMessage"
  | "images.maxPerRequest"
  | "images.resize.maxWidth"
  | "images.resize.maxHeight"
  | "images.resize.maxBytes"
  | "images.resize.jpegQuality";

/** 只替换一条路径，再把空掉的父对象剪掉；全空返回 undefined（调用方据此删掉 `inputLimits`）。 */
export function writeInputLimit(
  limits: ModelInputLimits | undefined,
  path: InputLimitPath,
  value: number | undefined,
): ModelInputLimits | undefined {
  // 不预建空的 `images` 键：它会以 `images: undefined` 的形式计入 Object.keys，
  // 让「全空 → undefined」的剪枝永远不成立。
  const next: ModelInputLimits = { ...(limits ?? {}) };
  if (path === "maxRequestBytes") {
    if (value === undefined) delete next.maxRequestBytes;
    else next.maxRequestBytes = value;
  } else if (path === "images.maxPerMessage" || path === "images.maxPerRequest") {
    const key = path.slice("images.".length) as "maxPerMessage" | "maxPerRequest";
    const images: ModelImageInputLimits = { ...(next.images ?? {}) };
    if (value === undefined) delete images[key];
    else images[key] = value;
    next.images = images;
  } else {
    const key = path.slice("images.resize.".length) as keyof ModelImageResizeOptions;
    const resize: ModelImageResizeOptions = { ...(next.images?.resize ?? {}) };
    if (value === undefined) delete resize[key];
    else resize[key] = value;
    next.images = { ...(next.images ?? {}), resize };
  }

  const images = next.images;
  if (images) {
    if (images.resize && Object.keys(images.resize).length === 0) delete images.resize;
    if (Object.keys(images).length === 0) delete next.images;
  }
  return Object.keys(next).length === 0 ? undefined : next;
}

/** `promptCache` 只有 `short` / `long` 两档（`ModelPromptCache`），单位是秒。 */
export function writePromptCacheSeconds(
  cache: ModelPromptCache | undefined,
  tier: keyof ModelPromptCache,
  value: number | undefined,
): ModelPromptCache | undefined {
  const next: ModelPromptCache = { ...(cache ?? {}) };
  if (value === undefined) delete next[tier];
  else next[tier] = value;
  return Object.keys(next).length === 0 ? undefined : next;
}

/** 复用 ModelsConfig 那一档数字输入框（画板 41 的规格行输入：`.pw-input` + `type=number`）。 */
function LimitNumInput({ id, value, placeholder, min, max, onChange }: {
  id: string;
  value: string;
  placeholder: string;
  min: number;
  max?: number;
  onChange: (raw: string) => void;
}) {
  return (
    <input
      id={id}
      type="number"
      className="pw-input"
      value={value}
      min={min}
      max={max}
      step={1}
      placeholder={placeholder}
      aria-label={id}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function ModelInputLimitsFields({
  inputLimits,
  promptCache,
  onInputLimitsChange,
  onPromptCacheChange,
}: {
  inputLimits: ModelInputLimits | undefined;
  promptCache: ModelPromptCache | undefined;
  onInputLimitsChange: (next: ModelInputLimits | undefined) => void;
  onPromptCacheChange: (next: ModelPromptCache | undefined) => void;
}) {
  const { t } = useI18n();
  const cacheValue = (tier: keyof ModelPromptCache) => limitText(promptCache?.[tier]);
  /** 输入框的值：undefined 渲染成空串（= 「没设」，不是 0）。 */
  const limitText = (value: number | undefined) => value === undefined ? "" : String(value);
  return (
    <>
      <ConfigSectionTitle>{t("models.inputLimitsTitle")}</ConfigSectionTitle>
      <div className="pw-grid2">
        <ConfigField label={t("models.limitMaxRequestBytes")}>
          <LimitNumInput
            id="models-limit-max-request-bytes"
            value={limitText(readInputLimit(inputLimits, "maxRequestBytes"))}
            placeholder="0"
            min={1}
            onChange={(raw) => onInputLimitsChange(writeInputLimit(inputLimits, "maxRequestBytes", parseLimitInput(raw, { min: 1 })))}
          />
        </ConfigField>
        <ConfigField label={t("models.limitImagesPerMessage")}>
          <LimitNumInput
            id="models-limit-images-per-message"
            value={limitText(readInputLimit(inputLimits, "images.maxPerMessage"))}
            placeholder="0"
            min={1}
            onChange={(raw) => onInputLimitsChange(writeInputLimit(inputLimits, "images.maxPerMessage", parseLimitInput(raw, { min: 1 })))}
          />
        </ConfigField>
        <ConfigField label={t("models.limitImagesPerRequest")}>
          <LimitNumInput
            id="models-limit-images-per-request"
            value={limitText(readInputLimit(inputLimits, "images.maxPerRequest"))}
            placeholder="0"
            min={1}
            onChange={(raw) => onInputLimitsChange(writeInputLimit(inputLimits, "images.maxPerRequest", parseLimitInput(raw, { min: 1 })))}
          />
        </ConfigField>
        <ConfigField label={t("models.limitResizeWidth")}>
          <LimitNumInput
            id="models-limit-resize-width"
            value={limitText(readInputLimit(inputLimits, "images.resize.maxWidth"))}
            placeholder="1568"
            min={1}
            onChange={(raw) => onInputLimitsChange(writeInputLimit(inputLimits, "images.resize.maxWidth", parseLimitInput(raw, { min: 1 })))}
          />
        </ConfigField>
        <ConfigField label={t("models.limitResizeHeight")}>
          <LimitNumInput
            id="models-limit-resize-height"
            value={limitText(readInputLimit(inputLimits, "images.resize.maxHeight"))}
            placeholder="1568"
            min={1}
            onChange={(raw) => onInputLimitsChange(writeInputLimit(inputLimits, "images.resize.maxHeight", parseLimitInput(raw, { min: 1 })))}
          />
        </ConfigField>
        <ConfigField label={t("models.limitResizeBytes")}>
          <LimitNumInput
            id="models-limit-resize-bytes"
            value={limitText(readInputLimit(inputLimits, "images.resize.maxBytes"))}
            placeholder="0"
            min={1}
            onChange={(raw) => onInputLimitsChange(writeInputLimit(inputLimits, "images.resize.maxBytes", parseLimitInput(raw, { min: 1 })))}
          />
        </ConfigField>
        <ConfigField label={t("models.limitJpegQuality")}>
          <LimitNumInput
            id="models-limit-jpeg-quality"
            value={limitText(readInputLimit(inputLimits, "images.resize.jpegQuality"))}
            placeholder="80"
            min={1}
            max={100}
            onChange={(raw) => onInputLimitsChange(writeInputLimit(inputLimits, "images.resize.jpegQuality", parseLimitInput(raw, { min: 1, max: 100 })))}
          />
        </ConfigField>
        <ConfigField label={t("models.promptCacheShort")}>
          <LimitNumInput
            id="models-prompt-cache-short"
            value={cacheValue("short")}
            placeholder="300"
            min={1}
            onChange={(raw) => onPromptCacheChange(writePromptCacheSeconds(promptCache, "short", parseLimitInput(raw, { min: 1 })))}
          />
        </ConfigField>
        <ConfigField label={t("models.promptCacheLong")}>
          <LimitNumInput
            id="models-prompt-cache-long"
            value={cacheValue("long")}
            placeholder="3600"
            min={1}
            onChange={(raw) => onPromptCacheChange(writePromptCacheSeconds(promptCache, "long", parseLimitInput(raw, { min: 1 })))}
          />
        </ConfigField>
      </div>
      <p className="pw-hint">{t("models.inputLimitsHint")}</p>
    </>
  );
}