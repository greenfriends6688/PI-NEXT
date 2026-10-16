/**
 * The desktop scene: a wallpaper, and the app as a floating macOS window over it.
 *
 * 玻璃效果 is the window drawn over the system blur, so it only means something where
 * there is a blur to show. A browser has no `NSVisualEffectView` — a page is the whole
 * document — so a translucent theme in one just washes out, which is why `HAS_VIBRANCY`
 * is false there and the setting is not even offered.
 *
 * The scene is how a browser gets to show it anyway: a colourful wallpaper fills the
 * viewport, `#root` becomes an inset rounded window whose own `backdrop-filter` stands in
 * for the material, and the bridge reports `simulatedVibrancy` so the theme goes
 * translucent. The marketing site's hero and this repository's README shots are taken this
 * way, and the site draws the same wallpaper and skeleton window at the same inset while
 * the frame loads — keep the inset and the gradient in step with it. (The site lives in
 * tyuan511/pinext-services; only this module is ours.)
 *
 * The inset is also what gives the app its edges: the panes float 8px inside `#root`, so a
 * 24px window radius is 8 + 16 and the two read as concentric.
 */

/** Where `#root` sits inside the viewport. The rounding below is built from it. */
export const DESKTOP_INSET = { x: 20, y: 16 } as const;

/** The window's corner radius: the panes' 16px plus the 8px inset they sit at. */
export const DESKTOP_RADIUS = 24;

let installed = false;

/**
 * Paint the scene. Idempotent, and safe to call before React mounts: it only touches
 * `<html>` and appends one `<style>`, both of which exist in the raw document.
 */
export function installDesktopScene(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.documentElement.dataset.desktop = "";

  const style = document.createElement("style");
  style.dataset.desktopScene = "";
  style.textContent = `
    html[data-desktop] {
      background:
        radial-gradient(42% 58% at 8% 12%, #ff7a45 0%, rgb(255 122 69 / 0) 70%),
        radial-gradient(38% 52% at 30% 92%, #ff3d8b 0%, rgb(255 61 139 / 0) 70%),
        radial-gradient(46% 60% at 92% 8%, #7c5cff 0%, rgb(124 92 255 / 0) 70%),
        radial-gradient(44% 56% at 78% 96%, #00c2d1 0%, rgb(0 194 209 / 0) 70%),
        radial-gradient(30% 40% at 58% 46%, #ffd166 0%, rgb(255 209 102 / 0) 70%),
        linear-gradient(135deg, #2b1b6b 0%, #0d2a4a 55%, #102c3a 100%);
    }
    html[data-desktop] body { background: transparent; }
    html[data-desktop] #root {
      position: fixed;
      inset: ${DESKTOP_INSET.y}px ${DESKTOP_INSET.x}px;
      height: auto;
      border-radius: ${DESKTOP_RADIUS}px;
      overflow: hidden;
      background: var(--desktop-material);
      -webkit-backdrop-filter: blur(56px) saturate(1.9);
      backdrop-filter: blur(56px) saturate(1.9);
      box-shadow:
        0 0 0 0.5px rgb(0 0 0 / 0.45),
        inset 0 0 0 0.5px rgb(255 255 255 / 0.22),
        0 36px 90px -24px rgb(0 0 0 / 0.6),
        0 14px 34px -12px rgb(0 0 0 / 0.4);
    }
    html[data-desktop].dark { --desktop-material: rgb(30 30 36 / 0.34); }
    html[data-desktop]:not(.dark) { --desktop-material: rgb(248 248 250 / 0.42); }
  `;
  document.head.append(style);
}
