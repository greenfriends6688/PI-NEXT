"use client";

import { Children, createContext, memo, useContext, useMemo, useRef, type ComponentProps, type MouseEvent } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import { parsePdfPageFragment, resolveLocalFileHref, shouldOpenLinkInApp, shouldOpenLocalFileInApp } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { markdownRehypePluginsFor, markdownRemarkPlugins, markdownUrlTransform, markdownUserRemarkPlugins, normalizeDisplayMath } from "@/lib/markdown";
import { mentionRehypePlugin, mentionRemarkPlugin, type MentionValidators } from "@/lib/mention-tokens";
import { splitStableParts } from "@/lib/markdown-incremental";
import { useThrottledText } from "@/hooks/useThrottledText";
import { ImagePreview } from "./ImagePreview";
import { useOpenLink } from "./LinkOpenContext";
import { MermaidBlock, CodeBlock } from "./MermaidBlock";
// fork:v5-wave-b —— PWA 形态：正文容器与表格换成画板 M-02 的 `.m-md` /
// `.m-tbl-scroll` + `.m-tbl`（手机上的第二条硬纪律：表格自带横滚）。
import { usePwaSkin } from "@/components/pwa/skin";

const MarkdownLinkContext = createContext(false);

function hastClassNames(node: ExtraProps["node"]): string[] {
  const className = node?.properties?.className;
  return Array.isArray(className) ? className.map(String) : [];
}

/** 松散任务列表项的正文是块级（<p> / <ul> …），不能塞进那个包裹用的 <span> 里。 */
function hasBlockLevelChild(node: ExtraProps["node"]): boolean {
  return (node?.children ?? []).some((child) => {
    if (child.type !== "element") return false;
    return child.tagName !== "input" && child.tagName !== "code" && child.tagName !== "del"
      && child.tagName !== "em" && child.tagName !== "strong" && child.tagName !== "a"
      && child.tagName !== "br" && child.tagName !== "img";
  });
}

/**
 * fork:open-link-in-app — 外链渲染。
 *
 * 默认单左键单击交给应用内的浏览器面板（`LinkOpenContext`，由 AppShell 提供）；
 * 带修饰键 / 中键仍然走 `target="_blank"`，也就是真正的系统浏览器。
 * 没有 provider（例如单独渲染的测试、或本就不该内嵌的场景）时保持原行为。
 */
function ExternalLink({ href, children, ...props }: ComponentProps<"a"> & ExtraProps) {
  const openLink = useOpenLink();
  const handleClick = openLink
    ? (event: MouseEvent<HTMLAnchorElement>) => {
        if (!shouldOpenLinkInApp(event) || !href) return;
        event.preventDefault();
        openLink(href);
      }
    : undefined;
  return (
    <a href={href} {...props} target="_blank" rel="noopener noreferrer" onClick={handleClick}>
      {children}
    </a>
  );
}

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string, page?: number) => void;
  /** D2-PR-12 — 打开消息正文里的 @file / /skill: mention 高亮（需要 validators）。 */
  highlightMentions?: boolean;
  /** D2-PR-12 — 合法性查询；数据未加载时返回 undefined（一律不高亮，不猜）。 */
  mentionValidators?: MentionValidators;
  /** fork:fix-user-line-breaks —— 用户消息：每一个换行都渲染成 <br>（#680 / #1015）。 */
  keepLineBreaks?: boolean;
}

function MarkdownImage({
  src,
  alt,
  cwd,
  ...props
}: ComponentProps<"img"> & ExtraProps & { cwd?: string }) {
  const insideLink = useContext(MarkdownLinkContext);
  delete props.node;
  const href = typeof src === "string" ? src : undefined;
  const filePath = href ? resolveLocalFileHref(href, cwd) : null;
  const imageSrc = filePath
    ? `/api/files/${encodeFilePathForApi(filePath)}?type=read`
    : href;
  // Dynamic local paths are served directly by the file API.
  // eslint-disable-next-line @next/next/no-img-element
  const image = <img src={imageSrc} alt={alt ?? ""} loading="lazy" {...props} />;
  if (!imageSrc || insideLink) return image;
  // fork:design-components —— 去掉 `markdown-image`：仓库里没有任何 CSS 命中它
  // （app/*.css 全无该选择器），按钮外观由 ImagePreview 自己的内联样式承担。
  return (
    <ImagePreview src={imageSrc} alt={alt ?? ""}>
      {image}
    </ImagePreview>
  );
}

/**
 * fork:markdown-incremental — 构造一套 markdown 叶子渲染器。
 *
 * `readStreaming` 用回调而不是布尔值：一次性渲染路径把读取推迟到渲染真正发生的
 * 那一刻（`streamingRef`），因此 `isStreaming` 翻转不会重建整棵 `components`、
 * 触发全量 reconcile（本仓库刻意的修复）；分块路径则各自闭包自己的分块标记。
 */
/**
 * fork:v5-wave-b —— `isPwa` 只是把**表格那一个渲染器**换成手机形态
 * （`.m-tbl-scroll > .m-tbl`，横滚由 m-tbl-scroll 承担）。它进入 `components`
 * 的依赖是安全的：这个布尔只在跨越 640px 断点时翻转一次，不会像 `isStreaming`
 * 那样每个 delta 都换一次渲染器身份。
 *
 * 其余渲染器（行内 code / 任务清单 / 引用 / katex / mention）在 PWA 库里**没有**
 * 对应件（缺件已登记），继续带 `d-*`：过渡口径下 d-* 规则在 ≤640px 仍然生效
 * （见 app/design/v5-forms.css），不是裸的。
 */
function buildMarkdownComponents(
  readStreaming: () => boolean,
  cwd: string | undefined,
  onOpenFile: ((filePath: string, page?: number) => void) | undefined,
  isPwa: boolean,
): Components {
  return {
    code({ className, children, node, ...props }) {
      const lang = className?.replace("language-", "").toLowerCase() ?? "";
      const raw = String(children);
      const isBlock = className?.includes("language-") || raw.includes("\n");
      const streaming = readStreaming();
      if (isBlock) {
        if (lang === "mermaid") {
          return (
            <MermaidBlock
              code={raw.replace(/\n$/, "")}
              isStreaming={streaming}
              defaultPreview
            />
          );
        }
        return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} isStreaming={streaming} />;
      }
      // fork:design-components —— 行内代码就是画板 10:110 的裸 `<code>`，
      // 芯片样式由 board.css:283 的 `.pw-md code` 给。`node` 是 react-markdown 的元数据。
      void node;
      return <code {...props}>{children}</code>;
    },
    pre({ children }) {
      return <>{children}</>;
    },
    // fork:v5-landing —— GFM 任务清单换成画板 D-03b 帧 F 的
    // `<ul class="d-tasklist">` + `<span class="d-checkbox on">`。
    // GFM 给的是 `<ul class="contains-task-list">` + `<li class="task-list-item">` + 原生 checkbox。
    ul({ node, children, ...props }) {
      const isTaskList = hastClassNames(node).includes("contains-task-list");
      return <ul {...props} className={isTaskList ? "d-tasklist" : undefined}>{children}</ul>;
    },
    li({ node, children, ...props }) {
      if (!hastClassNames(node).includes("task-list-item")) {
        return <li {...props}>{children}</li>;
      }
      // 画板 D-03b 帧 F 的行内结构：`<li><span class="d-checkbox on">…</span>text</li>`。
      // 勾选态由上面的 `input` 渲染器写成 `.d-checkbox`；松散列表项里 children
      // 可能是块级（<p>/<ul>），塞进 <span> 会让 HTML 解析器拆标签，那种情况保持原样
      // 交给 `.d-md .d-tasklist li` 的 flex 布局。
      const [box, ...rest] = Children.toArray(children);
      const body = hasBlockLevelChild(node)
        ? rest
        : [<span key="tasklist-text">{rest}</span>];
      return (
        <li>
          {box}
          {body}
        </li>
      );
    },
    // fork:v5-landing —— GFM 的原生 checkbox 换成画板 D-03b 帧 F 的
    // `<span class="d-checkbox on"><i data-ico="check" data-size="11"></i></span>`（纯展示，不可点）。
    input({ node, type, checked, ...props }: ComponentProps<"input"> & ExtraProps) {
      void node;
      if (type !== "checkbox") return <input type={type} checked={checked} {...props} />;
      return (
        <span
          className={checked ? "d-checkbox on" : "d-checkbox"}
          role="checkbox"
          aria-checked={checked === true ? "true" : "false"}
        >
          {checked && <i data-ico="check" data-size="11" />}
        </span>
      );
    },
    // fork:v5-landing —— 引用块 = 画板 D-03b 帧 F 的 `.d-quote`。
    blockquote({ node, children, ...props }) {
      void node;
      return <blockquote {...props} className="d-quote">{children}</blockquote>;
    },
    // fork:v5-landing —— rehype-katex 的两个根节点挂画板 D-03b 的 `.d-math`。
    //
    // 关键：`katex` / `katex-display` **必须保留**。katex.min.css 里有 370 条
    // `.katex .xxx` 后代选择器（`.katex .base`、`.katex .mord` …），去掉根类名整套
    // 数学排版就散架；`.katex-display > .katex` 也依赖这两个类同时存在。
    // 所以这里只在原类名后面**追加** d-math，不替换。
    span({ node, className, children, ...props }) {
      if (className === "katex-display") return <span {...props} className="katex-display d-math">{children}</span>;
      if (className === "katex") return <span {...props} className="katex d-math">{children}</span>;
      // fork:proma-34-mention —— mention 芯片 = 画板 D-03b 帧 F 的 `.d-mention`
      // （图标 + 等宽 token）。`data-mention-kind` 决定首枚图标。
      const mentionKind = node?.properties?.dataMentionKind;
      if (typeof mentionKind === "string") {
        const icon = mentionKind === "skill" ? "sparkles"
          : mentionKind === "mcp" ? "plug"
            : mentionKind === "session" ? "message-square"
              : mentionKind === "comment" ? "git-commit-horizontal"
                : "file-code";
        const mentionValue = node?.properties?.dataMentionValue;
        const previewable = node?.properties?.dataMentionPreviewable === true;
        const chip = (
          <span
            className="d-mention"
            data-mention-kind={mentionKind}
            data-mention-value={mentionValue}
            data-mention-previewable={previewable ? "true" : undefined}
          >
            <i data-ico={icon} data-size="10" />
            {children}
          </span>
        );
        if (previewable && typeof mentionValue === "string") {
          const filePath = resolveLocalFileHref(mentionValue, cwd);
          if (filePath) {
            return (
              <ImagePreview
                src={`/api/files/${encodeFilePathForApi(filePath)}?type=read`}
                alt={mentionValue}
                // 内联 chip 不能撑成整行：ImagePreview 的触发钮默认 block。
                style={{ display: "inline" }}
              >
                {chip}
              </ImagePreview>
            );
          }
        }
        return chip;
      }
      return <span {...props} className={className}>{children}</span>;
    },
    a({ href, children, ...props }) {
      // `node` is react-markdown metadata, not a DOM attribute.
      delete props.node;
      const filePath = onOpenFile ? resolveLocalFileHref(href, cwd) : null;
      // fork:pdf-page-fragment — resolveLocalFileHref drops `#…`; page lives only on the raw href.
      const page = onOpenFile ? parsePdfPageFragment(href) : null;
      const openFile = onOpenFile;
      if (!filePath || !openFile) {
        return (
          <MarkdownLinkContext.Provider value={true}>
            <ExternalLink href={href} {...props}>
              {children}
            </ExternalLink>
          </MarkdownLinkContext.Provider>
        );
      }

      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (!shouldOpenLocalFileInApp(event)) return;
        const target = event.currentTarget.getAttribute("target");
        if (target && target !== "_self") return;
        event.preventDefault();
        openFile(filePath, page ?? undefined);
      };

      return (
        <MarkdownLinkContext.Provider value={true}>
          <a href={href} {...props} onClick={handleClick}>
            {children}
          </a>
        </MarkdownLinkContext.Provider>
      );
    },
    img(props) {
      return <MarkdownImage cwd={cwd} {...props} />;
    },
    table({ children }) {
      if (isPwa) {
        // fork:v5-wave-b —— 窄屏抄 M-02 帧 B 的横滚表格：`.m-tbl-scroll` 横滚，
        // 表体是 `.m-tbl`（`.m-tbl th/td` 自带 `white-space: nowrap`）。
        return (
          <div className="m-tbl-scroll">
            <table className="m-tbl">{children}</table>
          </div>
        );
      }
      return (
        // fork:v5-landing —— GFM 表格直接用画板 D-03b 帧 B 的 .d-tbl-wrap + .d-table。
        <div className="d-tbl-wrap">
          <table className="d-table">{children}</table>
        </div>
      );
    },
  };
}

/**
 * fork:markdown-incremental — 一个稳定的 Markdown 分块。
 *
 * `memo` 用引用相等跳过没变的分块：稳定块的文本由 `splitStableParts` 的
 * interning cache（cyrb53）复用同一个字符串对象，所以流式期间只有增长的 tail
 * 会重跑 remark/rehype 管线，已完成区块不再重复解析。
 *
 * 稳定块按 `partStreaming=false` 渲染：块内代码围栏已经闭合，可以立刻走高亮/
 * Mermaid 预览；只有 tail 保持流式行为（Mermaid 显示源码、代码块纯文本）。
 */
const MarkdownPart = memo(function MarkdownPart({
  text,
  partStreaming,
  remarkPlugins,
  rehypePlugins,
  cwd,
  onOpenFile,
  isPwa,
}: {
  text: string;
  partStreaming: boolean;
  remarkPlugins: ComponentProps<typeof ReactMarkdown>["remarkPlugins"];
  rehypePlugins: ComponentProps<typeof ReactMarkdown>["rehypePlugins"];
  cwd?: string;
  onOpenFile?: (filePath: string, page?: number) => void;
  isPwa: boolean;
}) {
  const components = useMemo(
    () => buildMarkdownComponents(() => partStreaming, cwd, onOpenFile, isPwa),
    [partStreaming, cwd, onOpenFile, isPwa],
  );
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      urlTransform={onOpenFile ? markdownUrlTransform : undefined}
      components={components}
    >
      {text}
    </ReactMarkdown>
  );
});

export function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile, highlightMentions, mentionValidators, keepLineBreaks }: MarkdownBodyProps) {
  // fork:v5-wave-b —— 窄屏走画板 M-02 的 `.m-md`（同义：正文排版 + p/h1/h2 的间距）。
  const isPwa = usePwaSkin();
  // fork:fix-markdown-stream — 节流后的可见文本。
  //
  // 原先这里直接 `useMemo(normalizeDisplayMath, [children])`：`children` 是流式增长的
  // 字符串，每来一个 delta 都会让整条管线（normalizeDisplayMath 全文行扫描 +
  // react-markdown 全量 parse + rehype 全量 transform）重跑一遍，长回答因此越到
  // 尾越卡。现在流式期间最多每 120ms 重跑一次，且流式结束时一定交付完整文本。
  const visibleText = useThrottledText(children, { active: Boolean(isStreaming) });
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(visibleText), [visibleText]);
  // fork:fix-markdown-stream — 流式期间不跑同步 KaTeX 排版（见 lib/markdown.ts）。
  // D2-PR-12 — mention 高亮的两段式接线：
  // 1. remark 插件只在 text 节点上工作 → 代码块 / 行内代码里的 @xxx 永不改样式；
  // 2. sanitize 会剥掉 span 的 class/data（默认 schema，本 PR 不改 lib/markdown.ts），
  //    所以插件先产出哨兵链接，再由 mentionRehypePlugin 在 sanitize 之后还原成
  //    <span class="mention-token …">。
  const mentionPlugins = useMemo(
    () => (highlightMentions && mentionValidators ? [mentionRemarkPlugin(mentionValidators)] : []),
    [highlightMentions, mentionValidators],
  );
  const rehypePlugins = useMemo(() => {
    const base = markdownRehypePluginsFor(Boolean(isStreaming)) ?? [];
    return mentionPlugins.length ? [...base, mentionRehypePlugin] : base;
  }, [isStreaming, mentionPlugins]);
  // fork:fix-user-line-breaks —— 用户消息换用「保留换行」链（见 lib/markdown.ts）。
  // 必须在 mention 插件之前：本插件会把 text 节点拆成 text + 自定义换行节点，
  // mention 插件随后只在自己的 text 节点上工作，两者互不影响。
  const remarkPlugins = useMemo(() => {
    const base = keepLineBreaks ? markdownUserRemarkPlugins : markdownRemarkPlugins;
    return mentionPlugins.length ? [...(base ?? []), ...mentionPlugins] : base;
  }, [keepLineBreaks, mentionPlugins]);
  // 流式状态用 ref 透传给叶子渲染器，这样 `components` 的依赖里就不必包含
  // `isStreaming`：否则流式结束翻转那一下会让全部 code/img/a 渲染器 identity 失效，
  // 触发整棵消息树 reconcile。叶子在同一次 render 里读到的是最新值。
  const streamingRef = useRef(Boolean(isStreaming));
  streamingRef.current = Boolean(isStreaming);
  // Stable renderer identities keep stateful blocks mounted across message hover updates.
  const components = useMemo<Components>(
    () => buildMarkdownComponents(() => streamingRef.current, cwd, onOpenFile, isPwa),
    [cwd, onOpenFile, isPwa],
  );

  // fork:markdown-incremental — 稳定前缀块与增长的 tail 分开。
  //
  // interning cache 按内容哈希复用稳定块的字符串对象，配合 MarkdownPart 的
  // memo，流式期间已完成区块整块跳过 parse/rehype/Prism；未闭合的代码围栏
  // 会被 splitStableParts 整段拉进 tail，因此不会跨块撕裂。
  const partCacheRef = useRef<Map<string, string>>(new Map());
  const parts = useMemo(
    () => splitStableParts(normalizedMarkdown, partCacheRef.current),
    [normalizedMarkdown],
  );
  // 只有「流式 + 至少一个稳定块 + tail」才拆分渲染。流式结束后（或本来就不是
  // 流式）回到原来的单棵 ReactMarkdown，保证结束态与一次性渲染结果完全一致。
  const streamingSplit = Boolean(isStreaming) && parts.length > 1;

  // fork:v5-landing —— 助手正文容器 = 画板 D-03b 的 `.d-md`。
  // fork:v5-wave-b —— 窄屏 = M-02 的 `.m-md`。调用方传的 className
  // （markdown-user-message / markdown-compaction-message 等）原样保留。
  return (
    <div className={[isPwa ? "m-md" : "d-md", className].filter(Boolean).join(" ")}>
      {streamingSplit ? (
        parts.map((part, index) => (
          <MarkdownPart
            key={`${index}-${part.id}`}
            text={part.text}
            partStreaming={part.tail}
            remarkPlugins={remarkPlugins}
            rehypePlugins={rehypePlugins}
            cwd={cwd}
            onOpenFile={onOpenFile}
            isPwa={isPwa}
          />
        ))
      ) : (
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          urlTransform={onOpenFile ? markdownUrlTransform : undefined}
          components={components}
        >
          {normalizedMarkdown}
        </ReactMarkdown>
      )}
    </div>
  );
}
