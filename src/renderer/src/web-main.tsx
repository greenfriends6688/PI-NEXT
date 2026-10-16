import { installWebBridge } from "./web-bridge";
import { installDesktopScene } from "./lib/desktop-scene";

/**
 * The browser entry.
 *
 * `main.tsx` is the desktop entry: it mounts immediately, because `window.pinext` was
 * installed by the preload before any page script ran. A browser has no preload, so the
 * bridge has to be built first — and the app module has to be imported **after** it,
 * because `stores/settings` reads its snapshot at module scope and would otherwise cache
 * the empty defaults a browser starts with.
 *
 * That ordering is the whole reason this file exists instead of a branch inside `main.tsx`.
 */
void installWebBridge()
  .then(() => {
    // A browser tab has no system blur to draw a glass window over, so this paints one
    // before React mounts — the same wallpaper and material the preview harness and the
    // marketing site use, but full-bleed: the harness draws a floating macOS window
    // because that is what its screenshots are of, and a browser tab inset from its own
    // edges would just be a smaller app. Before `./main`: `lib/platform.ts` reads whether
    // there is vibrancy at module scope.
    installDesktopScene({ float: false });
    return import("./main");
  })
  .catch((error: unknown) => {
    const root = document.getElementById("root");
    if (root) {
      root.textContent = `连接失败：${error instanceof Error ? error.message : String(error)}`;
      root.style.cssText = "padding:18vh 1.5rem;text-align:center;font:14px system-ui,sans-serif;color:#c0392b";
    }
  });
