/*
 * fork:fix-clipboard — 复制要么成功，要么**明说**失败了。
 *
 * 之前这里是 `navigator.clipboard.writeText` 的裸转发。任何 secure context
 * （https / http://127.0.0.1 / file:）里 `navigator.clipboard.writeText` 都**存在**，
 * 所以函数里那段 `execCommand` 兜底分支是**死代码**：浏览器一旦拒绝写入
 * （权限被拒、跨源 iframe、失去用户手势、Firefox 的部分场景），Promise 直接 reject，
 * 而调用方普遍只写了 `.then(...)` 没有 `.catch`，于是「点复制纹丝不动」+ 控制台
 * `Uncaught (in promise) Failed to execute 'writeText' on 'Clipboard': Write permission denied`。
 *
 * 现在是一条**真正可用**的降级链：Clipboard API →（reject 之后）execCommand('copy')，
 * 并且**永远 resolve 成一个明确结果**，不再把 rejection 抛给调用方。调用方读 `ok`
 * 决定给不给用户反馈即可；失败时自己决定提示文案，不要在这里 console。
 *
 * 之所以敢在 reject 之后再跑 execCommand：写剪贴板靠的是 transient user activation，
 * 它按「点击后的时间窗」计算，不会因为跨了一个微任务就失效。
 */

/** 复制结果。`ok: false` 时调用方**必须**给用户一个可见反馈（静默失败是本次修的 bug）。 */
export type CopyResult =
  | { ok: true; via: "clipboard-api" | "exec-command" }
  | { ok: false; reason: "denied" | "unsupported" };

/**
 * `execCommand('copy')` 兜底：必须在**同一个用户手势**里同步跑完，所以它不是 async。
 * @param text 要写入剪贴板的文本
 * @returns 浏览器是否报告复制成功
 */
function execCommandCopy(text: string): boolean {
  // 之前是 innerHTML-free 的裸 textarea；这里补上 focus 还原与 iOS 的 setSelectionRange，
  // 否则兜底一次成功，键盘用户的焦点却被丢回 body（比复制失败还糟）。
  const previouslyFocused = document.activeElement as HTMLElement | null;
  const ta = document.createElement("textarea");
  ta.value = text;
  // readonly + tabIndex -1：别让软键盘弹出来，也别让它落进 Tab 序。
  ta.setAttribute("readonly", "");
  ta.setAttribute("aria-hidden", "true");
  ta.tabIndex = -1;
  // 必须 fixed + 移到视口外：static 定位的 textarea 会让 iOS 页面跳一下滚动。
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "-9999px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  try {
    ta.focus({ preventScroll: true });
    ta.select();
    // iOS Safari 只认 setSelectionRange（select() 在那里不生效）。
    ta.setSelectionRange(0, text.length);
    return document.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    ta.remove();
    // 把焦点还给用户刚才按下的那个控件。
    try {
      if (previouslyFocused && previouslyFocused !== document.body) {
        previouslyFocused.focus({ preventScroll: true });
      }
    } catch {
      // 元素已经卸载：没有焦点可还，无所谓。
    }
  }
}

/**
 * 走 Clipboard API。返回 `null` 表示「这条路没走通」，由调用方决定是否兜底。
 * @param text 要写入剪贴板的文本
 * @returns 成功结果，或 null 表示应改走 execCommand
 */
async function copyViaClipboardApi(text: string): Promise<CopyResult | null> {
  let clipboard: Clipboard | undefined;
  try {
    // 跨源 iframe / 老 WebView 里 `navigator.clipboard` 的 getter 本身可能抛。
    clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  } catch {
    return null;
  }
  if (!clipboard || typeof clipboard.writeText !== "function") return null;
  try {
    await clipboard.writeText(text);
    return { ok: true, via: "clipboard-api" };
  } catch {
    // 权限被拒 / 文档未聚焦 / 无用户手势 —— 不是致命错误，接着走兜底。
    return null;
  }
}

/**
 * 走 `execCommand('copy')` 兜底。
 * @param text 要写入剪贴板的文本
 * @returns 成功结果，或失败原因
 */
function copyViaExecCommand(text: string): CopyResult {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    return { ok: false, reason: "unsupported" };
  }
  // execCommand 会返回 false（而不是抛）来表达「用户/策略拒绝了这次写入」。
  return execCommandCopy(text)
    ? { ok: true, via: "exec-command" }
    : { ok: false, reason: "denied" };
}

/**
 * 把文本写进剪贴板。
 *
 * 降级链：`navigator.clipboard.writeText` → 失败则 `document.execCommand('copy')`。
 * 永远 resolve，**不会** reject。
 * @param text 要复制的文本
 * @returns 复制是否成功，以及成功时走的是哪条路
 */
export function copyText(text: string): Promise<CopyResult> {
  return copyViaClipboardApi(text).then((apiResult) => apiResult ?? copyViaExecCommand(text));
}