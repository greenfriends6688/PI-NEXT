import { animate } from "motion";

/**
 * fork:v6-landing —— Motion 弹簧的产品侧入口（画板 D-35 帧 F 裁定的落地件）。
 *
 * 两个最小动作，都尊重 prefers-reduced-motion（减弱动效直接跳到终态，不播过程）：
 *  - `springPop`   缩放过冲回弹（计数徽章、完成态徽章）—— 目标值会被弹簧冲过再
 *                  荡回来，这就是 beUI 手感的来源；
 *  - `springEnter` 入场（y 从上方落定 + 淡入）—— 审批卡等新出现的卡。
 *
 * Motion 12 的 spring 只吃单值目标（keyframes 数组静默不跑），所以两段式：
 * 弹到极值，finished 后弹簧回位。动画走 WAAPI，不改 React 状态、不触发渲染。
 */

const SPRING = { type: "spring", stiffness: 420, damping: 14, mass: 0.6 } as const;

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Animatable = Parameters<typeof animate>[0];

export function springPop(el: Animatable | null, peak = 1.16): void {
  if (!el || prefersReducedMotion()) return;
  try {
    const out = animate(el, { scale: peak }, SPRING);
    Promise.resolve(out.finished)
      .then(() => animate(el, { scale: 1 }, SPRING))
      .catch(() => {});
  } catch {
    // 库没加载好或元素已卸载：静默跳过，视觉退化为无动画
  }
}

export function springEnter(el: Animatable | null, fromY = 8): void {
  if (!el || prefersReducedMotion()) return;
  try {
    // 入场是「出现」类动效：过冲会怪（opacity 冲过 1 无意义），所以走 Motion 的
    // tween（V5 的 ease-out 曲线）；弹簧只给 pop 这类「到位后回弹」的语义。
    animate(el, { y: [-fromY, 0], opacity: [0, 1] }, {
      duration: 0.3, ease: [0.16, 0.84, 0.28, 1],
    });
  } catch {
    // 同上
  }
}
