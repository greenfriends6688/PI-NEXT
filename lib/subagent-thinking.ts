/**
 * PR-36 · `Agent` 工具 `thinkingLevel` 参数的归一化。
 *
 * 档位清单只有一份来源：`lib/thinking-request-core.ts` 的 `THINKING_LEVELS`
 * （镜像 pi-ai 的 `EXTENDED_THINKING_LEVELS`，与 `lib/rpc-manager.ts`、
 * `components/ChatInput.tsx` 的思考档控件同一套字符串）。这里不新造枚举。
 *
 * 归一化复用同一文件里镜像 pi-ai `clampThinkingLevel` 的 `clampLevelFromFields`：
 * 请求档位不受支持时先向上找更强的档、再向下找更弱的档，最后退回支持表首项 ——
 * 即「归一化到最近可用档位」，而不是报错。
 */
import {
  clampLevelFromFields,
  THINKING_LEVELS,
  type ThinkingLevel,
  type ThinkingModelFields,
} from "./thinking-request-core";

export { THINKING_LEVELS };
export type { ThinkingLevel };

/**
 * 把请求的思考档位夹到子代理模型真正支持的档位。
 *
 * @param requested 模型/用户请求的档位（非法字符串会被夹到支持表首项）。
 * @param model     子代理将要使用的模型字段（`reasoning` + 兼容信息）。
 * @param map       该模型的 `thinkingLevelMap`（`null` 表示该档不支持）。
 */
export function normalizeSubagentThinkingLevel(
  requested: string,
  model: ThinkingModelFields,
  map: Record<string, string | null> = {},
): ThinkingLevel {
  return clampLevelFromFields(model, requested, map) as ThinkingLevel;
}
