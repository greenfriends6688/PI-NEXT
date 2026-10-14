import { useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowShrink01Icon, FullScreenIcon, RefreshIcon } from "@hugeicons/core-free-icons";
import { IconButton } from "@/components/icon-button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * fork:trace-frame —— 右栏「调用轨迹」。
 *
 * 就是 pi 自己导出的那一页「完整历史」（`exportToHtml`），装进一个同源 iframe。
 * 页内已有的侧栏树、搜索与过滤不再另写一套；这里只放两枚钮：刷新与全屏。
 *
 * iframe 用 `sandbox="allow-scripts"`（**没有** `allow-same-origin`）：导出页里那些
 * 交互（展开工具输出、过滤）照常能跑，但它碰不到应用的存储与 cookie。
 */
export function TraceFrame({ conversationId }: { conversationId?: string }): JSX.Element {
  const { t } = useTranslation("sidepane");
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const load = useCallback(async () => {
    setHtml(null);
    setError(null);
    try {
      setHtml(await window.pinext.engine.exportHtmlDocument(conversationId));
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
      ) : html === null ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          <Spinner className="mr-2 size-3.5" />
          {t("trace.loading")}
        </div>
      ) : (
        <iframe
          title={t("trace.title")}
          className="min-h-0 flex-1 border-0 bg-background"
          sandbox="allow-scripts allow-popups"
          srcDoc={html}
        />
      )}
    </div>
  );
}
