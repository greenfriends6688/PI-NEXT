"use client";

/**
 * fork:perf-highlighter — the syntax highlighter, isolated in its own chunk.
 *
 * `code-splitting` note: this file must stay the *only* module that imports
 * react-syntax-highlighter, so the bundler can put it behind a dynamic import.
 * Upstream imported it statically in MermaidBlock.tsx, which pulled its ~1.5MB
 * (Prism with every language) into the initial chat route — every page load and
 * every file open paid for highlighting that most views never use.
 *
 * Themes are imported one file at a time (`styles/prism/vs`, not the
 * `styles/prism` barrel): the barrel re-exports ~200 themes and none of them
 * tree-shake reliably through CJS.
 *
 * ponytail: still ships Prism's full language set in the lazy chunk. Swap to
 * `PrismAsyncLight` + registerLanguage for the handful of languages we see if
 * that chunk ever shows up in a real performance profile.
 *
 * fork:design-components —— 两条渲染路径，视觉来源不同：
 *   - 默认导出（转录代码块）走画板 10 的 `.pw-code-body` + `.ln` + `.pw-tok-*`，
 *     不再注入任何内联色，board.css 是唯一着色来源；
 *   - `AsyncFileSourceView`（右栏文件查看器）是另一张画板的产品自有外观，保持原样。
 */

import {
  Prism as SyntaxHighlighter,
  createElement as renderSyntaxNode,
  type SyntaxHighlighterProps,
} from "react-syntax-highlighter";
import { type ReactNode } from "react";
import { FILE_CODE_STYLE, FILE_LINE_NUMBER_STYLE } from "@/lib/file-source-styles";
import vs from "react-syntax-highlighter/dist/esm/styles/prism/vs";
import vscDarkPlus from "react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus";

export type HighlighterProps = SyntaxHighlighterProps;

type SourceCodeRendererProps = Parameters<NonNullable<SyntaxHighlighterProps["renderer"]>>[0] & {
  wrapLines: boolean;
};

/**
 * One `<span class="file-source-line">` per source line, so the viewer's line numbers,
 * per-line location highlight and text selection keep working on top of Prism's token
 * tree. Moved here from FileViewer.tsx (which must not import this package at all).
 */
function SourceCodeRenderer({ rows, stylesheet, useInlineStyles, wrapLines }: SourceCodeRendererProps) {
  return rows.map((row, lineIndex) => {
    const children = row.children ?? [];
    const firstChildClasses = children[0]?.properties?.className;
    const hasLineNumber = Array.isArray(firstChildClasses)
      && firstChildClasses.includes("react-syntax-highlighter-line-number");
    const lineNumberNode = hasLineNumber ? children[0] : null;
    const contentNodes = hasLineNumber ? children.slice(1) : children;

    return (
      <span
        className="file-source-line"
        data-line-number={lineIndex + 1}
        key={`source-line-${lineIndex}`}
        style={{ display: "flex", minWidth: "100%" }}
      >
        {lineNumberNode && renderSyntaxNode({
          node: lineNumberNode,
          stylesheet,
          useInlineStyles,
          key: `source-line-number-${lineIndex}`,
        })}
        <span
          className="file-source-line-content"
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            overflowWrap: wrapLines ? "anywhere" : "normal",
            whiteSpace: wrapLines ? "pre-wrap" : "pre",
          }}
        >
          {contentNodes.map((node, tokenIndex) => renderSyntaxNode({
            node,
            stylesheet,
            useInlineStyles,
            key: `source-token-${lineIndex}-${tokenIndex}`,
          }))}
        </span>
      </span>
    );
  });
}

export interface FileSourceViewProps {
  code: string;
  language: string;
  isDark: boolean;
  wrapLines: boolean;
}

/** The file viewer's highlighted source view (see useLazyHighlighter.ts). */
export function AsyncFileSourceView({ code, language, isDark, wrapLines }: FileSourceViewProps) {
  return (
    <SyntaxHighlighter
      className={wrapLines ? "file-source-view is-wrapped" : "file-source-view"}
      language={language === "text" ? "plaintext" : language}
      style={isDark ? vscDarkPlus : vs}
      showLineNumbers
      lineNumberStyle={{ ...FILE_LINE_NUMBER_STYLE }}
      customStyle={{
        margin: 0,
        padding: 0,
        border: 0,
        background: "var(--bg)",
        ...FILE_CODE_STYLE,
        width: wrapLines ? "100%" : "max-content",
        minWidth: "100%",
        minHeight: "100%",
        overflow: "visible",
      }}
      codeTagProps={{
        style: {
          fontFamily: "var(--font-mono)",
          overflowWrap: wrapLines ? "anywhere" : "normal",
        },
      }}
      renderer={(rendererProps) => <SourceCodeRenderer {...rendererProps} wrapLines={wrapLines} />}
      wrapLongLines={wrapLines}
    >
      {code}
    </SyntaxHighlighter>
  );
}

type BoardRendererNode = Parameters<NonNullable<SyntaxHighlighterProps["renderer"]>>[0]["rows"][number];

/**
 * fork:design-components —— 画板 10:317-321 的 token 着色分层：`.pw-code-body` 里的
 * `.pw-tok-key / -str / -num / -fn / -com`。画板那几行是**类名**而不是内联色，
 * 所以这里关掉 RSH 的内联样式（`useInlineStyles: false` + 自带 renderer），
 * board.css 成为唯一着色来源，深浅色随 `--n-*` / `--success` / `--warning` 走。
 *
 * `.pw-tok-ref` / `.pw-tok-cmd`（board.css:769）属于 composer 输入框的 @ 引用与 / 命令，
 * 不是代码 token，因此不参与映射。
 * 未列出的 Prism token（operator / punctuation / variable / property / tag …）刻意留空：
 * 画板只定义了上面五档，再多就是自行发明配色。它们继承 `.pw-code-body` 的 `--n-text`。
 */
const BOARD_TOKEN_CLASS: Record<string, string> = {
  comment: "pw-tok-com", prolog: "pw-tok-com", doctype: "pw-tok-com", cdata: "pw-tok-com",
  keyword: "pw-tok-key", boolean: "pw-tok-key", atrule: "pw-tok-key", important: "pw-tok-key",
  string: "pw-tok-str", char: "pw-tok-str", "template-string": "pw-tok-str", "attr-value": "pw-tok-str",
  number: "pw-tok-num",
  function: "pw-tok-fn", "class-name": "pw-tok-fn", "function-variable": "pw-tok-fn",
};

function renderBoardNode(node: BoardRendererNode, key: string): ReactNode {
  if (node.type === "text") return node.value;
  const classNames = Array.isArray(node.properties?.className) ? node.properties.className.map(String) : [];
  const children = node.children?.map((child, index) => renderBoardNode(child, `${key}-${index}`));
  // 画板 10:152 的行号列 `<span class="ln">1</span>`。RSH 原本输出的是
  // `react-syntax-highlighter-line-number` 外加一串内联 minWidth / paddingRight / textAlign，
  // 这里换成 board.css:316 的 `.ln`（定宽 22px + `--n-placeholder` + 禁选）。
  if (classNames.includes("react-syntax-highlighter-line-number")) {
    return <span key={key} className="ln">{children}</span>;
  }
  const tokenClass = classNames.map((name) => BOARD_TOKEN_CLASS[name]).find(Boolean);
  return <span key={key} className={tokenClass}>{children}</span>;
}

const boardTokenRenderer: NonNullable<SyntaxHighlighterProps["renderer"]> = ({ rows }) =>
  rows.map((row, index) => renderBoardNode(row, `code-segment-${index}`));

/** 画板 10:152 的 `.pw-code-body` 容器：替掉 RSH 塞进来的 `prismjs` 类与整串内联样式。 */
function BoardCodeBody({ children }: { children?: ReactNode }) {
  return <pre className="pw-code-body">{children}</pre>;
}

/** `.pw-code-body` 自带 `white-space: pre`（board.css:314），RSH 的 `<code>` 包裹层是多余的。 */
function BoardCodeInner({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

/**
 * 转录代码块（MermaidBlock 的 `CodeBlock` 用的就是它）。
 * 容器 `.pw-code-body`、行号 `.ln`、token `.pw-tok-*` —— 全部落在 board.css 上，
 * 组件里不再出现任何颜色 / 尺寸字面量。`wrapLines={false}` 让行号与 token 同处一行，
 * 与画板 10:152 的写法一致（长行由 `.pw-code-body` 的 `overflow-x: auto` 横滚，不折行）。
 */
export default function AsyncCodeHighlighter({ children, language, showLineNumbers = true }: HighlighterProps) {
  return (
    <SyntaxHighlighter
      language={language}
      showLineNumbers={showLineNumbers}
      showInlineLineNumbers
      wrapLines={false}
      useInlineStyles={false}
      PreTag={BoardCodeBody}
      CodeTag={BoardCodeInner}
      renderer={boardTokenRenderer}
    >
      {children}
    </SyntaxHighlighter>
  );
}
