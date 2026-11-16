// The chat's small motions: an entrance and the layout animation a fold uses.
//
// NSH runs both natively (`docs/dev/animation.md`): `createAnimatedValue` +
// `Animated.timing` move an entrance on the UI thread, and `LayoutAnimation`
// animates the next commit's frames. Reduced motion (`reduceMotion()`) skips
// both and lands where the motion ends, as every shared example does
// (`ui/kit/theme.ts` `follow`, `ui/kit/look/press.ts`).
import {
  Animated,
  type AnimatedNode,
  cleanup,
  createAnimatedValue,
  Easing,
  LayoutAnimation,
  type LayoutAnimationConfig,
  reduceMotion,
  type ViewStyle,
} from "nsh";

/** How far a new row lifts from: pi-next's message entrance is a few points. */
const ENTER_DISTANCE = 8;
const ENTER_DURATION = 260;

export interface EnterOptions {
  /** Milliseconds, 260 by default. */
  duration?: number;
  /** Points the row rises from, 8 by default. */
  distance?: number;
  /** Milliseconds to wait before it starts. */
  delay?: number;
}

/**
 * A fade and a slight rise for a row that has just appeared (a prompt, a
 * reply, the reply being streamed). Call it once in a component body: it
 * starts the animation there and stops it with the component.
 *
 * The returned style binds the animated opacity and translation, so no JS
 * runs on the frames in between. `reduceMotion()` shows the row at rest.
 */
export function enter(options: EnterOptions = {}): ViewStyle {
  const progress = createAnimatedValue(0);
  const distance = options.distance ?? ENTER_DISTANCE;
  if (reduceMotion()) {
    progress.set(1);
  } else {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: options.duration ?? ENTER_DURATION,
      delay: options.delay ?? 0,
      easing: Easing.out(Easing.cubic),
    });
    void animation.start();
    cleanup(() => animation.stop());
  }
  const rise: AnimatedNode = progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] });
  return { opacity: progress, transform: [{ translateY: rise }] };
}

/**
 * Animates the frames of the next commit (a fold opening or shutting, a row
 * changing height), natively; with reduced motion the commit lands at once.
 * `Collapsible`'s `reveal` already scopes this to the region it moves, so a
 * fold uses that and only a caller that moves something else needs this.
 */
export function layout(config: LayoutAnimationConfig = LayoutAnimation.Presets.easeInEaseOut): void {
  if (reduceMotion()) return;
  LayoutAnimation.configureNext(config);
}
