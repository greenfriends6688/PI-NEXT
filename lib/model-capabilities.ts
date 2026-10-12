/**
 * fork:model-capabilities —— 模型能收哪几种输入（图片 / PDF / 音频 / 视频）。
 *
 * 参考项目那一列勾选框。本仓原来只有一枚「支持图片」开关，写 `input: ["text","image"]`；
 * 这里把它扩成四种模态，并统一收在这一个纯模块里 —— 发现层（`lib/model-discovery.ts`）、
 * 编辑器、列表行徽标读的都是同一份。
 *
 * **这是一份「能力声明」，不是闸门。** 写清楚免得以后有人以为勾掉图片就发不出图了：
 * 本仓没有一处拿 `models.json` 的 `input` 去拦附件 —— 能不能带图发给模型，由 pi 自己在
 * 请求组装时按 provider 的能力决定。这四个勾选框记的是「这个模型支持什么」，
 * 用来在界面上说清楚、以及给「替换模型」时一个参照；要变成真闸门是另一件事
 * （得先有一个统一的附件准入点），不在这一轮里假装已经做了。
 *
 * `text` 永远在：没有哪个对话模型不收文字。
 */

export const MODEL_INPUT_MODALITIES = ["image", "pdf", "audio", "video"] as const;
export type ModelInputModality = (typeof MODEL_INPUT_MODALITIES)[number];

/** 每个模态在 `input` 数组里的取值。与发现层读到的服务商写法一致。 */
export const MODALITY_INPUT_VALUE: Record<ModelInputModality, string> = {
  image: "image",
  pdf: "pdf",
  audio: "audio",
  video: "video",
};

export function isModelInputModality(value: unknown): value is ModelInputModality {
  return typeof value === "string" && (MODEL_INPUT_MODALITIES as readonly string[]).includes(value);
}

/** 归一化一份 `input`：永远是数组、永远含 `text`、去掉认不出的项、保持稳定顺序。 */
export function normalizeInputModalities(input: unknown): string[] {
  const seen = new Set<string>(["text"]);
  if (Array.isArray(input)) {
    for (const value of input) {
      if (value === "text" || isModelInputModality(value)) seen.add(value);
    }
  }
  return ["text", ...MODEL_INPUT_MODALITIES.filter((modality) => seen.has(modality))];
}

export function modelSupportsModality(input: unknown, modality: ModelInputModality): boolean {
  return normalizeInputModalities(input).includes(MODALITY_INPUT_VALUE[modality]);
}

/**
 * 勾 / 取消一个模态，返回新的 `input`。
 *
 * 取消之后如果**只剩 `text`**，返回 `undefined` —— 那正是「没说支持别的」的状态，
 * 写一个 `["text"]` 进 `models.json` 只会让文件里多一行废话（发现层也把两者当同一件事）。
 */
export function toggleInputModality(
  input: unknown,
  modality: ModelInputModality,
  enabled: boolean,
): string[] | undefined {
  const current = new Set(normalizeInputModalities(input));
  if (enabled) current.add(MODALITY_INPUT_VALUE[modality]);
  else current.delete(MODALITY_INPUT_VALUE[modality]);
  const next = ["text", ...MODEL_INPUT_MODALITIES.filter((item) => current.has(item))];
  return next.length > 1 ? next : undefined;
}
