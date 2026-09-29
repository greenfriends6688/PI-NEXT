"use client";

import { useEffect, useRef, useState } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab, undo } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import { Annotation, EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { getFileExt } from "@/lib/file-types";
import { getFileName } from "@/lib/file-paths";
import { useI18n } from "@/hooks/useI18n";
import { useTextFile } from "@/hooks/useMarkdownFile";
import { LOCATION_HIGHLIGHT_CLASS } from "@/lib/location-highlight";
import type {
  MarkdownEditorLocationApi,
  MarkdownEditorLocationTarget,
  MarkdownEditorSelection,
} from "@/lib/file-editor-types";

interface Props {
  filePath: string;
  content: string;
  sourceSessionId?: string | null;
  watchEnabled?: boolean;
  initialScrollTop?: number;
  initialScrollLeft?: number;
  hasPendingLocation?: boolean;
  /** True while the Source stage is the visible one (fork:perf-viewer-keepalive). */
  active?: boolean;
  /**
   * fork:perf-viewer-two-modes — fired once per completed save, with the buffer that
   * reached disk. The Source stage is the only writer now, so the viewer has to be told
   * about an edit or its own copy (and therefore the read-only Preview beside it) stays
   * on the pre-edit snapshot.
   */
  onContentSaved?: (content: string) => void;
  onScrollPositionChange?: (position: { scrollTop: number; scrollLeft: number }) => void;
  onSelectionChange?: (selection: MarkdownEditorSelection | null) => void;
  onLocationReady?: (api: MarkdownEditorLocationApi | null) => void;
}

const externalChange = Annotation.define<boolean>();
const setLocation = StateEffect.define<{ from: number; to: number; textFrom?: number; textTo?: number } | null>();
const locationField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    const effect = transaction.effects.find((item) => item.is(setLocation));
    if (effect) {
      if (!effect.value) return Decoration.none;
      const ranges = [];
      let position = effect.value.from;
      while (position <= effect.value.to && position <= transaction.state.doc.length) {
        const line = transaction.state.doc.lineAt(position);
        ranges.push(Decoration.line({ class: LOCATION_HIGHLIGHT_CLASS }).range(line.from));
        if (line.to >= effect.value.to || line.to === transaction.state.doc.length) break;
        position = line.to + 1;
      }
      if (effect.value.textFrom !== undefined && effect.value.textTo !== undefined
        && effect.value.textTo > effect.value.textFrom) {
        ranges.push(Decoration.mark({ class: "file-location-text-highlight" }).range(
          effect.value.textFrom,
          effect.value.textTo,
        ));
      }
      return Decoration.set(ranges, true);
    }
    return transaction.docChanged ? Decoration.none : value.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

function languageExtension(filePath: string): Extension {
  switch (getFileExt(filePath)) {
    case "ts":
    case "tsx":
      return javascript({ typescript: true, jsx: getFileExt(filePath) === "tsx" });
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return javascript({ jsx: getFileExt(filePath) === "jsx" });
    case "json":
    case "jsonl":
      return json();
    case "css":
    case "scss":
    case "less":
      return css();
    case "html":
    case "htm":
      return html();
    default:
      // Unsupported text formats still get a fully editable plain-text
      // surface, so editing and saving do not depend on a language package.
      return [];
  }
}

// fork:design-components —— 编辑器配色不再读产品自己的色槽，全部取画板 token
// （画板 52 的 `.pw-code-body` / `.pw-diff-body` 就是这一组）。
const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    minHeight: "100%",
    color: "var(--n-text)",
    backgroundColor: "var(--surface-canvas)",
    fontSize: "var(--text-mono)",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--font-mono)",
    lineHeight: "1.7",
  },
  ".cm-content": {
    minHeight: "100%",
    padding: "16px 0 48px",
  },
  ".cm-line": {
    padding: "0 16px",
  },
  ".cm-gutters": {
    color: "var(--n-placeholder)",
    backgroundColor: "var(--surface-panel)",
    borderRight: "1px solid var(--n-border-subtle)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--overlay-selected)",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--overlay-selected)",
  },
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--accent) 30%, transparent) !important",
  },
});

export default function CodeFileEditor({
  content,
  filePath,
  sourceSessionId,
  watchEnabled = true,
  initialScrollTop = 0,
  initialScrollLeft = 0,
  hasPendingLocation = false,
  onScrollPositionChange,
  onSelectionChange,
  onLocationReady,
  active,
  onContentSaved,
}: Props) {
  const { t } = useI18n();
  const { sync, state } = useTextFile(filePath, content, sourceSessionId, watchEnabled);
  // 画板 52 帧 A 的 `.pw-card-foot` 读数：行列来自编辑器自己的 update，不另开数据流。
  const [cursor, setCursor] = useState<readonly [number, number]>([1, 1]);
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const editorPathRef = useRef(filePath);
  const initialScrollTopRef = useRef(initialScrollTop);
  const initialScrollLeftRef = useRef(initialScrollLeft);
  const hasPendingLocationRef = useRef(hasPendingLocation);
  const onScrollPositionChangeRef = useRef(onScrollPositionChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onLocationReadyRef = useRef(onLocationReady);
  const onContentSavedRef = useRef(onContentSaved);
  onScrollPositionChangeRef.current = onScrollPositionChange;
  onSelectionChangeRef.current = onSelectionChange;
  onLocationReadyRef.current = onLocationReady;
  onContentSavedRef.current = onContentSaved;
  if (editorPathRef.current !== filePath) {
    editorPathRef.current = filePath;
    initialScrollTopRef.current = initialScrollTop;
    initialScrollLeftRef.current = initialScrollLeft;
    hasPendingLocationRef.current = hasPendingLocation;
  }

  useEffect(() => {
    if (!host.current || !sync) return;
    let disposed = false;
    const notifySelection = (view: EditorView) => {
      const selection = view.state.selection.main;
      if (selection.empty) {
        onSelectionChangeRef.current?.(null);
        return;
      }
      const from = Math.min(selection.from, selection.to);
      const to = Math.max(selection.from, selection.to);
      const startLine = view.state.doc.lineAt(from).number;
      let endLine = view.state.doc.lineAt(to).number;
      // Match the existing source-view behavior: a selection ending at the
      // start of a line does not claim that empty line.
      if (endLine > startLine && to === view.state.doc.line(endLine).from) endLine -= 1;
      const fromRect = view.coordsAtPos(from);
      const toRect = view.coordsAtPos(to);
      const fallback = view.dom.getBoundingClientRect();
      const text = view.state.doc.sliceString(from, to).trim();
      if (!text) {
        onSelectionChangeRef.current?.(null);
        return;
      }
      const top = Math.min(window.innerHeight - 44, Math.max(fromRect?.bottom ?? fallback.top + 24, toRect?.bottom ?? fallback.top + 24) + 8);
      const left = Math.max(8, Math.min(window.innerWidth - 8, ((fromRect?.left ?? fallback.left) + (toRect?.right ?? fromRect?.right ?? fallback.right)) / 2));
      onSelectionChangeRef.current?.({
        text,
        startLine,
        endLine,
        top,
        left,
      });
    };
    const revealLocation = (target: MarkdownEditorLocationTarget) => {
      const current = viewRef.current;
      if (!current) return [];
      const doc = current.state.doc;
      const requestedStart = Number.isInteger(target.startLine) ? target.startLine! : 0;
      const requestedEnd = Number.isInteger(target.endLine) ? target.endLine! : requestedStart;
      let startLine = requestedStart;
      let endLine = requestedEnd;
      const snapshot = (target.text ?? "").trim();
      if (startLine < 1 || endLine < startLine || startLine > doc.lines) {
        const match = snapshot ? doc.toString().indexOf(snapshot) : -1;
        if (match < 0) return [];
        startLine = doc.lineAt(match).number;
        endLine = doc.lineAt(Math.min(doc.length, match + snapshot.length)).number;
      }
      endLine = Math.min(endLine, doc.lines);
      const from = doc.line(startLine).from;
      const to = doc.line(endLine).to;
      const textPosition = snapshot ? doc.toString().indexOf(snapshot, from) : -1;
      const hasExactText = textPosition >= from && textPosition + snapshot.length <= to;
      const textFrom = hasExactText ? textPosition : undefined;
      const textTo = textFrom === undefined ? undefined : textFrom + snapshot.length;
      current.dispatch({
        effects: [
          setLocation.of({ from, to, textFrom, textTo }),
          EditorView.scrollIntoView(from, { y: "center" }),
        ],
      });
      // The editor owns the decoration. Returning its root tells FileViewer
      // that the asynchronous location request was handled successfully.
      return [current.dom];
    };
    const view = new EditorView({
      state: EditorState.create({
        doc: sync.state.content,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          highlightSpecialChars(),
          drawSelection(),
          history(),
          bracketMatching(),
          indentOnInput(),
          foldGutter(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          locationField,
          languageExtension(filePath),
          EditorState.allowMultipleSelections.of(true),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          editorTheme,
          EditorView.domEventHandlers({
            compositionstart: () => { sync.setComposing(true); return false; },
            compositionend: () => {
              setTimeout(() => { if (!disposed) sync.setComposing(false); }, 0);
              return false;
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(externalChange))) {
              sync.edit(update.state.doc.toString());
            }
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            setCursor((previous) => (previous[0] === line.number && previous[1] === head - line.from + 1 ? previous : [line.number, head - line.from + 1] as const));
            notifySelection(view);
          }),
        ],
      }),
      parent: host.current,
    });
    viewRef.current = view;
    const scrollDOM = view.scrollDOM;
    const reportScrollPosition = () => {
      onScrollPositionChangeRef.current?.({ scrollTop: scrollDOM.scrollTop, scrollLeft: scrollDOM.scrollLeft });
    };
    scrollDOM.addEventListener("scroll", reportScrollPosition, { passive: true });
    const restoreFrame = hasPendingLocationRef.current ? null : window.requestAnimationFrame(() => {
      scrollDOM.scrollTop = initialScrollTopRef.current;
      scrollDOM.scrollLeft = initialScrollLeftRef.current;
      reportScrollPosition();
    });
    const locationApi: MarkdownEditorLocationApi = {
      revealLocation,
      clearLocation: () => {
        if (!viewRef.current) return;
        viewRef.current.dispatch({ effects: setLocation.of(null) });
      },
    };
    onLocationReadyRef.current?.(locationApi);
    notifySelection(view);

    return () => {
      disposed = true;
      if (restoreFrame !== null) window.cancelAnimationFrame(restoreFrame);
      scrollDOM.removeEventListener("scroll", reportScrollPosition);
      onLocationReadyRef.current?.(null);
      onSelectionChangeRef.current?.(null);
      viewRef.current = null;
      view.destroy();
    };
  }, [filePath, sync]);

  // fork:perf-viewer-keepalive — the editor stays mounted while the Diff stage is
  // showing, so it has to re-measure when it becomes visible again: a `display: none`
  // container reports zero geometry, which makes CodeMirror's viewport and caret
  // coordinates stale until the next measure.
  useEffect(() => {
    if (active) viewRef.current?.requestMeasure();
  }, [active]);

  // fork:perf-viewer-two-modes — hand the committed buffer to the viewer on the
  // save-completion edge, so the read-only Preview shows what Source just wrote without
  // a round trip (and without fighting the edge-triggered external-sync below).
  const wasSavingRef = useRef(false);
  useEffect(() => {
    if (state.saving) {
      wasSavingRef.current = true;
      return;
    }
    if (!wasSavingRef.current) return;
    wasSavingRef.current = false;
    if (!state.error && state.conflicts.length === 0) onContentSavedRef.current?.(state.content);
  }, [state.saving, state.error, state.conflicts.length, state.content]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === state.content) return;
    const anchor = Math.min(view.state.selection.main.anchor, state.content.length);
    const head = Math.min(view.state.selection.main.head, state.content.length);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: state.content },
      selection: { anchor, head },
      annotations: externalChange.of(true),
    });
  }, [state.content]);

  // fork:design-components —— 画板 52 帧 A（编辑中）/ 帧 B（保存冲突）：
  // 外壳 `.pw-viewer`，头是 `.pw-viewer-head`（路径 + 类型徽章 + 一个状态徽章 + 撤销/保存），
  // 冲突片段是 `.pw-detail` + `.pw-litem`，保存失败是 `.pw-alert`，
  // 底是 `.pw-card-foot`（行列 · 类型 · EOL · 编码）。尺寸/字号/圆角只有一个来源。
  const typeLabel = getFileExt(filePath).replace(/^\./, "").toUpperCase();
  const hasConflicts = state.conflicts.length > 0;
  const unsaved = sync?.dirty ?? false;

  return (
    <div className="pw-viewer">
      <div className="pw-viewer-head">
        <span className="pw-ico"><i data-ico={hasConflicts ? "triangle-alert" : "file-code"} data-size="13"></i></span>
        <span className="pw-mono">{getFileName(filePath)}</span>
        {typeLabel && <span className="pw-badge">{typeLabel}</span>}
        {hasConflicts && <span className="pw-badge warn">{t("files.conflict")}</span>}
        {!hasConflicts && unsaved && <span className="pw-badge warn">{t("files.unsavedChanges")}</span>}
        <span className="grow" />
        <button
          type="button"
          className="pw-btn sm"
          title={t("models.catalogUndo")}
          aria-label={t("models.catalogUndo")}
          onClick={() => { const view = viewRef.current; if (view) undo(view); }}
        >
          <span className="pw-ico"><i data-ico="undo-2" data-size="13"></i></span>
        </button>
        <button
          type="button"
          className="pw-btn primary sm"
          onClick={() => void sync?.save()}
          disabled={state.saving || !unsaved}
        >
          <span className="pw-ico"><i data-ico="save" data-size="13"></i></span>
          {t("files.saveFile")}
        </button>
      </div>

      {state.error && (
        <div className="pw-alert" role="alert">
          <span>{t("files.textSaveFailed")} {state.error}</span>
          <span className="grow" />
          <button type="button" className="pw-btn sm" onClick={() => sync?.retry()}>{t("files.textRetry")}</button>
        </div>
      )}

      {hasConflicts && (
        <div className="pw-detail">
          <h3>{t("files.textConflict")}</h3>
          {state.conflicts.map((conflict) => (
            <div key={conflict.key} style={{ display: "grid", gap: "var(--s2)", marginTop: "var(--s2)" }}>
              <pre className="pw-code-body grow">{conflict.local}</pre>
              <button
                type="button"
                className="pw-btn sm"
                onClick={() => sync?.resolve(conflict.key, "local")}
              >
                {t("files.textKeepLocal")}
              </button>
              <pre className="pw-code-body grow">{conflict.external}</pre>
              <button
                type="button"
                className="pw-btn sm"
                onClick={() => sync?.resolve(conflict.key, "external")}
              >
                {t("files.textUseExternal")}
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        ref={host}
        className="pw-code-body grow"
        aria-label={getFileName(filePath)}
        data-saving={state.saving ? "true" : "false"}
      />

      <div className="pw-card-foot">
        <span className="pw-ico pw-dim"><i data-ico="circle" data-size="12"></i></span>
        <span>Ln {cursor[0]} · Col {cursor[1]}</span>
        <span className="grow" />
        <span>{typeLabel} · {state.content.includes("\r\n") ? "CRLF" : "LF"}, "UTF-8"</span>
      </div>
    </div>
  );
}
