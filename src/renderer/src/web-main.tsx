import { installWebBridge } from "./web-bridge";

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
  .then(() => import("./main"))
  .catch((error: unknown) => {
    const root = document.getElementById("root");
    if (root) {
      root.textContent = `连接失败：${error instanceof Error ? error.message : String(error)}`;
      root.style.cssText = "padding:18vh 1.5rem;text-align:center;font:14px system-ui,sans-serif;color:#c0392b";
    }
  });
