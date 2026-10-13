import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * fork:fastvibe-stack (H1) — className 合并的唯一入口。
 *
 * FastVibe 用 `cn` 包（`src/renderer/src/lib/utils.ts` 只有一行 `export { cn } from "cn"`），
 * 那个包内部就是 `twMerge(clsx(...))` 的封装（实测 `cn/dist/index.js`：`createEngine(tables)`
 * → `wrapClsx(mergeString, ...)`）。本仓用公认的三件套直接等价实现 —— 少一个依赖，
 * 且 clsx / tailwind-merge 都是 shadcn 生态的原生组合。
 *
 * 语义（与 `cn` 包一致）：
 *   · clsx 部分：字符串 / 数组 / 对象条件（`condition && "class"` 也走这里）；
 *   · twMerge 部分：**后者覆盖前者**的同类 Tailwind 工具类（`px-2 px-4` → `px-4`），
 *     这是它能替代手写 `className` 拼接的原因 —— 覆盖顺序由调用处决定。
 *
 * 注意它**只合并 Tailwind 工具类**：本仓旧体系的 `d-*` / `m-*` / `pw-*` / `fork-*`
 * 是普通类名，twMerge 不认识也就不动它们，所以过渡期两套可以安全地写在同一个
 * `cn()` 里（这也是批次 L 逐页迁移期间的主要用法）。
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
