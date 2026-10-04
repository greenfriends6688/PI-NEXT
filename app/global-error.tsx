"use client";
import { TEXT } from "@/lib/typography";

/**
 * fork:gap-error-boundary — 根布局级错误边界。
 *
 * `app/error.tsx` 覆盖不到根 `layout.tsx` 自身的错误，这一层负责兜住那种情况。
 * 按 Next 16 约定：必须自己渲染 `<html>` / `<body>`，且不会带上应用的全局样式与
 * `data-theme`（主题切换在这里失效），所以这里直接跟随系统深浅色，不假设任何 token。
 *
 * fork:design-components —— 结构照画板 D-26b 帧 B「根级 · app/global-error.tsx」：
 * `.d-card-body` + `.d-t-title` / `.d-t-cap` / `.d-mono` / `.d-row` + `.d-btn`。
 * 这一层全局样式没接上，因此每处配色/字号仍带内联兜底值（Canvas / CanvasText）。
 *
 * fork:v5-wave-b-sysstate —— M-11 帧 F-2 的右半：**这一层不许换 m-* 类**。
 * 理由是画板自己写着的：根级必须自己渲染 html/body，全局样式与 data-theme 都
 * 没接上，`m-modal` / `m-empty` / `m-touch-44` 全都不生效，用它们渲染错误页
 * 等于用可能正是出问题的那套东西去渲染错误页。所以只把触控下限（44）
 * 以内联 minHeight 补上，其余形态差异（底色 / 字阶）本来就跟系统色。
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="zh-CN">
      <head>
        <title>PI NEXT</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
          background: "Canvas",
          color: "CanvasText",
        }}
      >
        <div
          className="d-card-body"
          role="alert"
          style={{
            maxWidth: 520,
            width: "100%",
            background: "Canvas",
            color: "CanvasText",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "var(--nx-sp-4, 16px)",
          }}
        >
          <div className="d-t-title" style={{ opacity: 0.92, fontSize: TEXT["2xl"], fontWeight: 600, lineHeight: 1.25 }}>
            应用启动失败 / Failed to start
          </div>
          <div className="d-t-cap" style={{ opacity: 0.8, fontSize: TEXT.md, lineHeight: 1.7 }}>
            根布局渲染时出现异常。请先重试；若持续失败，打开开发者工具查看控制台堆栈。
            <br />
            An error occurred while rendering the root layout. Retry first; if it persists, check the console.
          </div>
          {error.digest && (
            <div className="d-mono d-t-xs" style={{ opacity: 0.7, fontFamily: "var(--nx-font-mono, monospace)", fontSize: TEXT.sm }}>
              digest {error.digest}
            </div>
          )}
          <div className="d-row" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              className="d-btn sm"
              onClick={() => retry()}
              style={{ minHeight: 44, minWidth: 44, height: "auto", padding: "6px 14px", borderRadius: 6, border: "1px solid currentColor", background: "transparent", color: "inherit", cursor: "pointer", font: "inherit" }}
            >
              重试 / Retry
            </button>
            <button
              type="button"
              className="d-btn sm"
              onClick={() => window.location.reload()}
              style={{ minHeight: 44, minWidth: 44, height: "auto", padding: "6px 14px", borderRadius: 6, border: "1px solid currentColor", background: "transparent", color: "inherit", cursor: "pointer", font: "inherit" }}
            >
              重新加载 / Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
