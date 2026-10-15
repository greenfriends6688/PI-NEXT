import { useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowShrink01Icon, FullScreenIcon, RefreshIcon } from "@hugeicons/core-free-icons";
import { mediaPreviewUrl } from "@shared/media-preview";
import { IconButton } from "@/components/icon-button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * fork:trace-frame —— 右栏「调用轨迹」。
 *
 * 就是 pi 自己导出的那一页「完整历史」（`exportToHtml`），放在一个 iframe 里。
 * 页内已有的侧栏树、搜索与过滤不再另写一套；这里只放两枚钮：刷新与全屏。
 *
 * **它必须是一个独立文档，不能是 `srcDoc`。** 导出页整个 UI 都靠一段内联
 * `<script>` 构建，而 `srcDoc` 的文档会继承应用的 CSP（`src/renderer/index.html`
 * 是 `script-src 'self'`，没有 `'unsafe-inline'`）—— 脚本被拒，iframe 里就是一片空白。
 * 所以主进程把导出页写进 `tracesDir`，这里用 `pinext-media://` 打开它；那条协议的
 * 响应头由 `media-protocol.ts` 自己写（`INLINE_HTML_CSP` 允许内联脚本），
 * 与内联 HTML 预览走的是同一条路。
 *
 * iframe 仍然是 `sandbox="allow-scripts"`（**没有** `allow-same-origin`）：
 * 页里那些交互（展开工具输出、过滤）照常能跑，但它碰不到应用的存储与 cookie。
 */
export function TraceFrame({ conversationId }: { conversationId?: string }): JSX.Element {
  const { t } = useTranslation("sidepane");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const load = useCallback(async () => {
    setUrl(null);
    setError(null);
    try {
      const file = await window.pinext.engine.exportHtmlDocument(conversationId);
      // The file name is fixed per conversation, so a refresh rewrites the same path and
      // the browser would keep showing the bytes it already has. `no-store` on the response
      // is not enough either: React would not reassign an unchanged `src`. The stamp makes
      // every load a different URL, and `mediaPathFromUrl` reads only `path`.
      setUrl(`${mediaPreviewUrl(file)}&v=${Date.now()}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", fullscreen && "fixed inset-0 z-50 bg-background")}>
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{t("trace.title")}</span>
        <IconButton size="icon-xs" variant="ghost" label={t("trace.refresh")} onClick={() => void load()}>
          <HugeiconsIcon strokeWidth={2} icon={RefreshIcon} />
        </IconButton>
        <IconButton
          size="icon-xs"
          variant="ghost"
          aria-pressed={fullscreen}
          label={fullscreen ? t("trace.exitFullscreen") : t("trace.fullscreen")}
          onClick={() => setFullscreen((value) => !value)}
        >
          <HugeiconsIcon strokeWidth={2} icon={fullscreen ? ArrowShrink01Icon : FullScreenIcon} />
        </IconButton>
      </div>
      {error ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-muted-foreground">{error}</div>
      ) : url === null ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          <Spinner className="mr-2 size-3.5" />
          {t("trace.loading")}
        </div>
      ) : (
        <iframe
          title={t("trace.title")}
          className="min-h-0 flex-1 border-0 bg-background"
          sandbox="allow-scripts allow-popups"
          src={url}
        />
      )}
    </div>
  );
}
