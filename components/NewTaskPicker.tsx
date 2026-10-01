"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

/**
 * Workspace picker for the 新建任务 row (fork feature:
 * `docs/patches/0001-chat-workspace.md`).
 *
 * Rendered beside the primary 新建任务 button: the button keeps its upstream
 * behaviour, this chevron only chooses *where* the new task goes — any known
 * project, or the standalone chat workspace ("不在项目中"). Picking an entry moves
 * the workspace and opens a fresh composer there (same result as selecting the
 * project first and then clicking 新建任务).
 *
 * Kept in its own file so the sidebar diff stays a wiring change.
 */
/** 来源徽标用产品本名（品牌名不翻译）。 */
const SOURCE_LABELS: Record<string, string> = {
  vscode: "VS Code",
  claude: "Claude Code",
  codex: "Codex",
  zed: "Zed",
  opencode: "OpenCode",
};

export function NewTaskPicker({
  projects,
  activeKey,
  chatPath,
  onNewIn,
  onAddProject,
}: {
  projects: { key: string; root: string; name: string }[];
  activeKey: string | null;
  chatPath: string | null;
  onNewIn: (cwd: string) => void;
  onAddProject: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // fork:recent-projects — 菜单打开时才去读「其它编辑器最近打开的工作区」：
  // 平时不发请求，读完也只在本地去重一次（同一个目录已经在上面的项目列表里就不再出现，
  // 这里是个选择器，不是发现列表）。
  const [recent, setRecent] = useState<{ path: string; source: string }[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetch("/api/recent-projects")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { projects?: Array<{ path: string; source: string }> } | null) => {
        if (!cancelled) setRecent(data?.projects ?? []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // fork:design-system SW-03 —— 行 = 画板 51 的 pw-prow（当前项 is-on + check）。
  const itemClass = "pw-prow";

  const knownRoots = new Set(projects.map((project) => project.root.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()));
  const recentSuggestions = recent
    .filter((project) => !knownRoots.has(project.path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()))
    .slice(0, 5);

  const choose = (cwd: string) => {
    setOpen(false);
    onNewIn(cwd);
  };

  return (
    <div ref={rootRef} style={{ flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={t("sidebar.newTaskChooseProject")}
        aria-label={t("sidebar.newTaskChooseProject")}
        aria-expanded={open}
        aria-haspopup="menu"
        style={{
          width: 26,
          height: "var(--control-lg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          background: open ? "var(--bg-selected)" : "transparent",
          border: "none",
          borderRadius: "var(--radius-md)",
          color: open ? "var(--text)" : "var(--text-dim)",
          cursor: "pointer",
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="pw-pop"
          style={{
            // Anchored to the whole 新建任务 row: this element's positioning ancestor
            // is the wrapper in SessionSidebar, not this narrow chevron.
            position: "absolute",
            top: "calc(100% + 2px)",
            left: 0,
            right: 0,
            zIndex: 100,
            maxHeight: "min(60vh, 420px)",
            overflowY: "auto",
          }}
        >
          {projects.length > 0 && (
            <div className="pw-pop-title">{t("sidebar.newTaskChooseProject")}</div>
          )}
          {/* 推荐区放在项目列表之后、分隔线之前；点击走与项目相同的 onNewIn，
              也就是同一条 /api/cwd/validate 注册 allow-root 的路径。 */}
          {recentSuggestions.length > 0 && (
            <>
              <div className="pw-sep" />
              <div className="pw-pop-title">{t("sidebar.newTaskRecommended")}</div>
              {recentSuggestions.map((project) => (
                <button
                  key={project.path}
                  type="button"
                  role="menuitem"
                  className={itemClass}
                  title={project.path}
                  onClick={() => choose(project.path)}
                >
                  <span className="pw-ico" style={{ flexShrink: 0 }}><i data-ico="arrow-up" data-size="14"></i></span>
                  <span className="grow" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {project.path.split("/").filter(Boolean).at(-1) ?? project.path}
                  </span>
                  <span className="pw-desc" style={{ flexShrink: 0 }}>{SOURCE_LABELS[project.source] ?? project.source}</span>
                </button>
              ))}
            </>
          )}
          {projects.map((project) => (
            <button
              key={project.key}
              type="button"
              role="menuitem"
              className={itemClass}
              title={project.root}
              onClick={() => choose(project.root)}
            >
              <span className="pw-ico" style={{ flexShrink: 0 }}><i data-ico="folder" data-size="14"></i></span>
              <span className="grow" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {project.name}
              </span>
              {project.key === activeKey && (
                <span className="pw-ico" style={{ flexShrink: 0, color: "var(--success)" }}>
                  <i data-ico="check" data-size="14"></i>
                </span>
              )}
            </button>
          ))}

          <div className="pw-sep" />

          <button
            type="button"
            role="menuitem"
            className={itemClass}
            disabled={!chatPath}
            title={chatPath ?? undefined}
            onClick={() => { if (chatPath) choose(chatPath); }}
          >
            <span className="pw-ico" style={{ flexShrink: 0 }}><i data-ico="message-square" data-size="14"></i></span>
            <span className="grow" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t("sidebar.newTaskNoProject")}
            </span>
          </button>

          <div className="pw-sep" />

          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              setOpen(false);
              onAddProject();
            }}
          >
            <span className="pw-ico" style={{ flexShrink: 0 }}><i data-ico="plus" data-size="14"></i></span>
            <span className="grow">{t("sidebar.addProject")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
