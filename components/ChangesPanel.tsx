"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./v3/Icon";
import { DiffView } from "./FileViewer";
import { useI18n } from "@/hooks/useI18n";
import type { GitFileStatus, GitStatusResponse } from "@/lib/git-types";

/**
 * design/v3/boards/web-changes.html：`± 所有变更` 卡片。
 * 上面一行是文件数与该仓库的增删总量，下面一个文件一段 diff（`.dline` 行，
 * 与 18-diff 同一套渲染）。点文件名在右栏打开该文件的差异视图。
 */
export function ChangesPanel({
  cwd,
  onClose,
  onOpenFile,
  inline = false,
}: {
  cwd: string;
  onClose: () => void;
  onOpenFile: (filePath: string, fileName: string, options?: { modeHint?: "diff" }) => void;
  /** 作为右栏的一页画（fastvibe 的 review 页签），而不是浮在窗口上的卡片。 */
  inline?: boolean;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<GitStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [patches, setPatches] = useState<Record<string, { patch?: string; error?: string }>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    setError(null);
    setPatches({});
    void (async () => {
      try {
        const res = await fetch(`/api/git/status?cwd=${encodeURIComponent(cwd)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as GitStatusResponse;
        if (cancelled) return;
        setStatus(data);
        // 默认只展开前三段（画板也是几段）：三十几个文件一次铺开会有上千行 diff。
        setExpanded(Object.fromEntries((data.files ?? []).slice(0, 3).map((file) => [file.filePath, true])));
      } catch (fetchError) {
        if (!cancelled) setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      }
    })();
    return () => { cancelled = true; };
  }, [cwd]);

  const files = useMemo<GitFileStatus[]>(() => status?.files ?? [], [status]);

  // 每个文件的 patch 单独拉：一个文件的 diff 坏了不影响其他段。
  useEffect(() => {
    if (files.length === 0) return;
    let cancelled = false;
    const load = async (filePath: string) => {
      try {
        const res = await fetch(`/api/git/diff?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(filePath)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { supported?: boolean; patch?: string };
        if (cancelled) return;
        setPatches((current) => ({ ...current, [filePath]: data.supported && data.patch ? { patch: data.patch } : { error: t("files.noDiff") } }));
      } catch (diffError) {
        if (cancelled) return;
        setPatches((current) => ({ ...current, [filePath]: { error: diffError instanceof Error ? diffError.message : String(diffError) } }));
      }
    };
    // 并行度 4：几十个改动文件时也不会一次打出几十个 git 子进程。
    const queue = [...files.map((file) => file.filePath)];
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length > 0 && !cancelled) {
        const next = queue.shift();
        if (next) await load(next);
      }
    });
    void Promise.all(workers);
    return () => { cancelled = true; };
  }, [cwd, files, t]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !inline) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [inline, onClose]);

  const stats = (patch: string) => {
    let additions = 0;
    let deletions = 0;
    for (const line of patch.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions++;
      else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
    }
    return { additions, deletions };
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t("files.allChanges")}
      className={`changes-panel${inline ? " is-inline" : ""}`}
    >
      <header className="changes-panel__head">
        <span className="changes-panel__title">
          <Icon name="plusminus" />
          {t("files.allChanges")}
        </span>
        <span className="changes-panel__count">
          {t("files.changedFiles", { count: files.length })}
          {status && (status.additions > 0 || status.deletions > 0) && (
            <>
              <span className="add">+{status.additions}</span>
              <span className="del">−{status.deletions}</span>
            </>
          )}
        </span>
        {/* 作为右栏的一页时，关它的是页签上的 ×，这里不再放第二颗。 */}
        {!inline && (
          <button
            type="button"
            className="cbtn cbtn--sm"
            onClick={onClose}
            title={t("i18n.close")}
            aria-label={t("i18n.close")}
          >
            <Icon name="xmark" />
          </button>
        )}
      </header>

      <div className="changes-panel__body scrollbar-subtle">
        {error && <div className="changes-panel__empty">{error}</div>}
        {!error && !status && <div className="changes-panel__empty">{t("files.loading")}</div>}
        {status && files.length === 0 && <div className="changes-panel__empty">{t("files.noChanges")}</div>}
        {files.map((file) => {
          const entry = patches[file.filePath];
          const counts = entry?.patch ? stats(entry.patch) : null;
          const isOpen = expanded[file.filePath] !== false;
          return (
            <section key={file.filePath} className="changes-file">
              <button
                type="button"
                className="changes-file__head"
                onClick={() => setExpanded((current) => ({ ...current, [file.filePath]: !isOpen }))}
                title={file.filePath}
                aria-expanded={isOpen}
              >
                <Icon name="doc-text" />
                <span className="changes-file__path trunc">{file.filePath}</span>
                <span className="changes-file__status">{file.code}</span>
                {counts && (
                  <span className="changes-file__stat">
                    <span className="add">+{counts.additions}</span>
                    <span className="del">−{counts.deletions}</span>
                  </span>
                )}
                <Icon name={isOpen ? "chevron-up" : "chevron-down"} />
              </button>
              {isOpen && (
                <div className="changes-file__body">
                  {entry?.patch ? (
                    <>
                      <div className="changes-file__open">
                        <button
                          type="button"
                          className="btn btn--sm"
                          onClick={() => onOpenFile(file.filePath, file.filePath.split(/[\\/]/).pop() ?? file.filePath, { modeHint: "diff" })}
                        >
                          {t("files.openDiff")}
                        </button>
                      </div>
                      <DiffView patch={entry.patch} />
                    </>
                  ) : (
                    <div className="changes-panel__empty">{entry?.error ?? t("files.loading")}</div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
