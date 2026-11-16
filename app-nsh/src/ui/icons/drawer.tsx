// Lucide icons drawn on a Canvas: the gallery's `draw` + `LucideIcon`
// (`examples/gallery/icons.tsx`), self-contained (this app's `token()`
// colors, no gallery module), over the generated icon table in `lucide.ts`.
import { Canvas, type CanvasRenderingContext2D, Path2D } from "nsh";
import { colors } from "../colors";
import { lucide, type LucideElement, type LucideName } from "./lucide";

/** The Lucide icons this app draws (`lucide.ts`, generated). */
export type LucideIconName = LucideName;

/** The numbers of an SVG `points` list, in pairs. */
function points(list: string): number[] {
  return list
    .trim()
    .split(/[\s,]+/)
    .map(Number);
}

/** Draws one element as Lucide's SVG does: stroked, never filled. */
function draw(cx: CanvasRenderingContext2D, el: LucideElement) {
  switch (el.tag) {
    case "path":
      cx.stroke(new Path2D(el.d));
      return;
    case "circle":
      cx.beginPath();
      cx.arc(el.cx, el.cy, el.r, 0, Math.PI * 2);
      break;
    case "ellipse":
      cx.beginPath();
      cx.ellipse(el.cx, el.cy, el.rx, el.ry, 0, 0, Math.PI * 2);
      break;
    case "rect":
      cx.beginPath();
      cx.roundRect(el.x, el.y, el.width, el.height, el.rx ?? 0);
      break;
    case "line":
      cx.beginPath();
      cx.moveTo(el.x1, el.y1);
      cx.lineTo(el.x2, el.y2);
      break;
    case "polyline":
    case "polygon": {
      const p = points(el.points);
      cx.beginPath();
      cx.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) cx.lineTo(p[i], p[i + 1]);
      if (el.tag === "polygon") cx.closePath();
      break;
    }
  }
  cx.stroke();
}

/**
 * A Lucide icon on its 24 × 24 grid, stroked with `tint` (the theme's text
 * color when not given), width 2, round caps and joins.
 */
export function Icon(props: { name: LucideIconName; size?: number; tint?: string }) {
  const size = props.size ?? 20;
  return (
    <Canvas
      style={{ pointerEvents: "none", width: size, height: size }}
      draw={(cx, { width }) => {
        cx.scale(width / 24, width / 24);
        // TODO(nsh): verify that reading `props.tint` and `token()` in a `draw` redraws
        // the canvas when they change (`docs/dev/canvas.md:3-6` says `draw` runs again
        // on the signals it reads).
        cx.strokeStyle = props.tint ?? colors.text;
        cx.lineWidth = 2;
        cx.lineCap = "round";
        cx.lineJoin = "round";
        for (const el of lucide[props.name] as LucideElement[]) draw(cx, el);
      }}
    />
  );
}
