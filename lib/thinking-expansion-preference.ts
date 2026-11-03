
const STORAGE_KEY = "pi-thinking-expanded";

// Broadcast so already-mounted ThinkingBlock instances update when the
// preference changes in the settings panel.
export const THINKING_EXPANDED_EVENT = "pi-thinking-expanded-changed";

export function isThinkingExpandedByDefault(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setThinkingExpandedByDefault(expanded: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(expanded));
  } catch {
    // 什么都没存下，也就没什么可广播的。
    return;
  }
  window.dispatchEvent(new Event(THINKING_EXPANDED_EVENT));
}
