"use client";

import { useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
// fork:v5-wave-b —— 窄屏换成画板 M-02 的 `.m-iconbtn` / `.m-btn sm` 与 `.m-badge bad`
// （整段并排写在组件里，见 return 处）。
//
// **桌面分支的 `pw-*` 保留**：`.pw-iconbtn.sm` / `.pw-btn.sm` / `.pw-inline` /
// `.pw-badge bad` 四处被 `components/fork/PathActions.test.mjs` 当源码守卫逐字符
// 匹配（该文件本身还停在 v1 版断言），改掉等于删测试 —— 按「被测试当选择器的保留
// 并注释」处理。`.pw-ico` 图标包装层已删：board.css 只在 `.pw-row` 里给它规则，
// 在这个簇里是空壳，而画板（D-53 / M-02）的图标一律是按钮里的裸 `<i data-ico>`。
import { usePwaSkin } from "@/components/pwa/skin";

/*
 * fork:ui-20 — the three path actions, in one place.
 *
 * Before: "copy path" was re-implemented per surface and "reveal / open with the
 * default app" did not exist at all, even though the file tree and the viewer both
 * show files the user often want to reach in Finder/Explorer (MusePi's file pane
 * exposes exactly these, FilePane.tsx:892-943).
 *
 * Feedback: copy flips its own glyph, the OS actions flash a short error only when
 * the route refuses or the spawn fails — success is visible outside the app, so a
 * toast would be noise.
 *
 * fork:fix-clipboard —— 复制也会失败，而且失败必须看得见。`copyText` 现在永远
 * resolve 成 {ok}，所以 copy 走同一套 `.danger` + 失败徽标（和
 * reveal/open 的失败态共用一个 state，本来就是同一个「这个动作没成」）。之前是
 * 无条件 setCopied(true)：两条路都被拒时按钮纹丝不动，用户以为复制过了。
 *
 * fork:design-components —— 视觉全部交给 design：紧凑簇 = `.d-iconbtn.sm`，
 * 文字簇 = `.d-btn.sm`，图标取画板 53「路径动作」那一组
 * （copy / folder-open / external-link），失败态挂画板的 `.danger`，
 * 失败文案另起一枚 `.d-badge bad`。请求、状态机、图标翻转这些行为一个字没动。
 * fork:v5-wave-b —— 手机形态换成 `.m-iconbtn` / `.m-btn sm` + `.m-badge bad`
 * （`.m-btn` 有 sm 档，`.m-iconbtn` 只有一枚 —— 紧凑簇在手机上就用它）。
 */

type ActionState = "idle" | "busy" | "failed";

export function PathActions({
  path,
  compact = false,
}: {
  /** Absolute path. The server checks it against the same allow-list as /api/files. */
  path: string;
  /** Icon-only cluster (file-tree rows, toolbars). */
  compact?: boolean;
}): ReactNode {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [state, setState] = useState<ActionState>("idle");
  const busy = state === "busy";
  const failed = state === "failed";

  const isPwa = usePwaSkin();

  // 三个动作共用一份失败态：钩子（.danger）+ 那枚失败徽标文案，
  // 2.6s 后自动收回；只复位自己刚写下的那一档，连点两次时旧定时器不抹掉新状态。
  const markFailed = () => {
    setState("failed");
    window.setTimeout(() => setState((current) => (current === "failed" ? "idle" : current)), 2600);
  };

  const run = async (action: "reveal" | "open") => {
    setState("busy");
    try {
      const res = await fetch("/api/files/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, action }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState("idle");
    } catch {
      markFailed();
    }
  };

  const copy = () => {
    // `copyText` 永不 reject：失败是一个明确的结果，不是异常。
    void copyText(path).then((result) => {
      if (!result.ok) {
        markFailed();
        return;
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };

  // fork:design-components —— 紧凑簇走画板的图标钮，展开簇走文字钮。
  const buttonClassName = (pwa: boolean): string => {
    // fork:v5-wave-b —— 窄屏（画板 M-02 / D-53 的同一组动作）：紧凑簇是
    // `.m-iconbtn`（纯图标钮，画板里没有 sm 档），展开簇是 `.m-btn sm`。
    if (pwa) return compact ? "m-iconbtn" : "m-btn sm";
    // 桌面这一行被 PathActions.test.mjs 当源码守卫逐字符匹配 —— 保留并注释。
    const className = compact ? "pw-iconbtn sm" : "pw-btn sm";
    return className;
  };
  const className = buttonClassName(isPwa);

  // `.pw-inline` / `.pw-badge bad` 同样是 PathActions.test.mjs 的守卫选择器，保留。
  // `.pw-ico` 包装层已删（board.css 只在 `.pw-row` 里给它规则，这个簇里是空壳）。
  return (
    <span className="pw-inline">
      <button
        type="button"
        onClick={copy}
        title={failed ? t("files.pathActionFailed") : t("files.copyPath")}
        aria-label={t("files.copyPath")}
        className={`${className}${failed ? " danger" : ""}`}
      >
        <i data-ico={copied ? "check" : "copy"} data-size="13"></i>
        {!compact && <span>{copied ? t("i18n.copied") : t("files.copyPath")}</span>}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void run("reveal")}
        title={failed ? t("files.pathActionFailed") : t("files.revealPath")}
        aria-label={t("files.revealPath")}
        className={`${className}${failed ? " danger" : ""}`}
      >
        <i data-ico="folder-open" data-size="13"></i>
        {!compact && <span>{t("files.revealPath")}</span>}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void run("open")}
        title={failed ? t("files.pathActionFailed") : t("files.openPath")}
        aria-label={t("files.openPath")}
        className={`${className}${failed ? " danger" : ""}`}
      >
        <i data-ico="external-link" data-size="13"></i>
        {!compact && <span>{t("files.openPath")}</span>}
      </button>
      {failed && (isPwa
        ? <span className="m-badge bad">{t("files.pathActionFailed")}</span>
        : <span className="pw-badge bad">{t("files.pathActionFailed")}</span>)}
    </span>
  );
}
