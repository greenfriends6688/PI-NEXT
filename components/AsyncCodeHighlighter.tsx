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
 *   - 默认导出（转录代码块）走画板 10 的 `.d-code-body` + `.d-ln` + `.tok-*`，
 *     不再注入任何内联色，system.css 是唯一着色来源；
 *   - `AsyncFileSourceView`（右栏文件查看器）是另一张画板的产品自有外观，保持原样。
 *
 * fork:v5-wave-b —— PWA 形态（≤640px）：`isPwa` 时容器换成画板 M-02 的
 * `.m-code-scroll > .m-code-body`，行号列换成 `.m-ln`。
 *
 * fork:v5-landing-close —— 窄屏 token 改挂 PWA 库自己的五档
 * （`.m-tok-key / str / num / com / fn`）。此前这里只发 `tok-*`（桌面类），
 * 而窄屏不挂桌面库 → 代码块是单色的。`fn`（函数名 / 方法名 / 类名）是 PWA
 * 那一档比桌面多出来的，桌面 `.tok-*` 只有四档 —— 窄屏按 PWA 的五档走。
 * 这里只读一个布尔，不参与任何渲染逻辑；高亮与否仍是 `shouldHighlightCode`。
 */

import { usePwaSkin } from "@/components/pwa/skin";

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
 * fork:v5-landing —— 画板 D-03b 帧 C 的 token 着色分层：`.d-code-body` 里的
 * `.tok-k / -s / -n / -c`。画板那几行是**类名**而不是内联色，
 * 所以这里关掉 RSH 的内联样式（`useInlineStyles: false` + 自带 renderer），
 * system.css 成为唯一着色来源，深浅色随 `--nx-code-*` 走。
 *
 * 未列出的 Prism token（operator / punctuation / variable / property / tag …）刻意留空：
 * 画板只定义了上面四档，再多就是自行发明配色。它们继承 `.d-code-body` 的 `--nx-text`。
 */
const BOARD_TOKEN_CLASS: Record<string, string> = {
  comment: "tok-c", prolog: "tok-c", doctype: "tok-c", cdata: "tok-c",
  keyword: "tok-k", boolean: "tok-k", atrule: "tok-k", important: "tok-k",
  string: "tok-s", char: "tok-s", "template-string": "tok-s", "attr-value": "tok-s",
  number: "tok-n",
};

/**
 * fork:v5-landing-close —— 窄屏用 PWA 库的五档（`design/v5/pwa/system.css`）。
 * 与桌面那张表的差别只有两条：**类名前缀** `m-tok-`，以及多出的 `fn` 档
 * （函数 / 方法 / 类名 —— 手机上代码块窄，函数名恰恰是最需要一眼认出来的一档）。
 * 未列出的 token 与桌面同样留空，继承 `.m-code-body` 的前景色。 */
const BOARD_TOKEN_CLASS_PWA: Record<string, string> = {
  comment: "m-tok-com", prolog: "m-tok-com", doctype: "m-tok-com", cdata: "m-tok-com",
  keyword: "m-tok-key", boolean: "m-tok-key", atrule: "m-tok-key", important: "m-tok-key",
  string: "m-tok-str", char: "m-tok-str", "template-string": "m-tok-str", "attr-value": "m-tok-str",
  number: "m-tok-num",
  function: "m-tok-fn", "function-variable": "m-tok-fn", method: "m-tok-fn",
  "class-name": "m-tok-fn", "maybe-class-name": "m-tok-fn",
};

function renderBoardNode(node: BoardRendererNode, key: string, isPwa: boolean): ReactNode {
  if (node.type === "text") return node.value;
  const classNames = Array.isArray(node.properties?.className) ? node.properties.className.map(String) : [];
  const children = node.children?.map((child, index) => renderBoardNode(child, `${key}-${index}`, isPwa));
  // 画板 D-03b 帧 C 的行号列 `<span class="d-ln">1</span>`。RSH 原本输出的是
  // `react-syntax-highlighter-line-number` 外加一串内联 minWidth / paddingRight / textAlign，
  // 这里换成 system.css 的 `.d-ln`（定宽 + `--nx-text-3` + 禁选）。
  // fork:v5-wave-b —— 窄屏是 M-02 帧 A 的 `<span class="m-ln">1</span>`（同构）。
  if (classNames.includes("react-syntax-highlighter-line-number")) {
    return <span key={key} className={isPwa ? "m-ln" : "d-ln"}>{children}</span>;
  }
  const tokenClass = classNames
    .map((name) => (isPwa ? BOARD_TOKEN_CLASS_PWA[name] : BOARD_TOKEN_CLASS[name]))
    .find(Boolean);
  return <span key={key} className={tokenClass}>{children}</span>;
}

/** 画板 D-03b 帧 C 的 `.d-code-body` 容器：替掉 RSH 塞进来的 `prismjs` 类与整串内联样式。
 *  fork:v5-wave-b —— 窄屏是 M-02 帧 A 的 `.m-code-scroll` 横滚层 + `.m-code-body`。 */
function BoardCodeBody({ children, isPwa = false }: { children?: ReactNode; isPwa?: boolean }) {
  if (isPwa) {
    return (
      <div className="m-code-scroll">
        <div className="m-code-body">{children}</div>
      </div>
    );
  }
  return <div className="d-code-body">{children}</div>;
}

/** `.d-code-body` 自带 `white-space: pre`，RSH 的 `<code>` 包裹层是多余的。 */
function BoardCodeInner({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

/**
 * 转录代码块（MermaidBlock 的 `CodeBlock` 用的就是它）。
 * 容器 `.d-code-body`、行号 `.d-ln`、token `.tok-*` —— 全部落在 system.css 上，
 * 组件里不再出现任何颜色 / 尺寸字面量。`wrapLines={false}` 让行号与 token 同处一行，
 * 与画板 D-03b 的写法一致（长行由 `.d-code-body` 的 `overflow-x: auto` 横滚，不折行）。
 */
export default function AsyncCodeHighlighter({ children, language, showLineNumbers = true }: HighlighterProps) {
  const isPwa = usePwaSkin();
  return (
    <SyntaxHighlighter
      language={language}
      showLineNumbers={showLineNumbers}
      showInlineLineNumbers
      wrapLines={false}
      useInlineStyles={false}
      // fork:v5-wave-b —— `PreTag` 是 RSH 允许换的标签组件（不是标签**字符串**），
      // 所以这里传的是同一个组件的两个形态实例，输出结构完全由 PWA 画板决定。
      PreTag={isPwa ? BoardCodeBodyPwa : BoardCodeBody}
      CodeTag={BoardCodeInner}
      renderer={isPwa ? boardTokenRendererPwa : boardTokenRenderer}
    >
      {children}
    </SyntaxHighlighter>
  );
}

/** fork:v5-wave-b —— PWA 形态的两个 renderer（与桌面同一份实现，只是绑定 isPwa）。 */
function BoardCodeBodyPwa(props: { children?: ReactNode }) {
  return <BoardCodeBody isPwa {...props} />;
}

const boardTokenRendererPwa: NonNullable<SyntaxHighlighterProps["renderer"]> = ({ rows }) =>
  rows.map((row, index) => renderBoardNode(row, `code-segment-${index}`, true));

const boardTokenRenderer: NonNullable<SyntaxHighlighterProps["renderer"]> = ({ rows }) =>
  rows.map((row, index) => renderBoardNode(row, `code-segment-${index}`, false));
