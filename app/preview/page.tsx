"use client";

import Link from "next/link";
import { Fragment, useState, type ReactNode } from "react";
import {
  IconArrowRight,
  IconArrowUp,
  IconAt,
  IconBranch,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconClose,
  IconFile,
  IconFiles,
  IconFolder,
  IconList,
  IconMore,
  IconPanelLeft,
  IconPaperclip,
  IconPin,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSparkle,
  IconTerminal,
} from "./icons";

type ThemeKey = "breeze" | "breeze-dark" | "mocha" | "claude";

const THEMES: { key: ThemeKey; label: string; short: string; swatch: string }[] = [
  {
    key: "breeze",
    label: "Breeze 浅色",
    short: "Breeze",
    swatch: "linear-gradient(135deg, #ffffff 0%, #ffffff 42%, #7ba58f 100%)",
  },
  {
    key: "breeze-dark",
    label: "Breeze 深色",
    short: "Breeze 深色",
    swatch: "linear-gradient(135deg, #1e1e20 0%, #1e1e20 42%, #7ba58f 100%)",
  },
  {
    key: "mocha",
    label: "Catppuccin 摩卡",
    short: "摩卡",
    swatch: "linear-gradient(135deg, #1e1e2e 0%, #1e1e2e 42%, #cba6f7 100%)",
  },
  {
    key: "claude",
    label: "Claude",
    short: "Claude",
    swatch: "linear-gradient(135deg, #1a1816 0%, #1a1816 42%, #c15f3c 100%)",
  },
];

type SessionState = "running" | "waiting" | "idle";

type Session = {
  id: string;
  title: string;
  project: string;
  branch: string;
  time: string;
  state: SessionState;
};

const PINNED: Session[] = [
  { id: "s1", title: "重做工作区外壳", project: "pi-web", branch: "main", time: "刚刚", state: "running" },
  { id: "s2", title: "打磨 MCP OAuth 登录", project: "pi-web", branch: "main", time: "2 小时", state: "waiting" },
];

const GROUPS: { project: string; branch: string; sessions: Session[] }[] = [
  {
    project: "pi-web",
    branch: "main",
    sessions: [
      { id: "s3", title: "会话侧栏：置顶与归档", project: "pi-web", branch: "main", time: "4 小时", state: "idle" },
      { id: "s4", title: "修复重连后的缓存未命中提示", project: "pi-web", branch: "main", time: "昨天", state: "idle" },
      { id: "s5", title: "限制 MCP 测试连接时长", project: "pi-web", branch: "main", time: "昨天", state: "idle" },
    ],
  },
  {
    project: "tivano",
    branch: "main",
    sessions: [
      { id: "s6", title: "Breeze 主题对比度调整", project: "tivano", branch: "main", time: "周一", state: "idle" },
      { id: "s7", title: "Hydra 合并评审", project: "tivano", branch: "main", time: "周一", state: "idle" },
    ],
  },
  {
    project: "fastvibe",
    branch: "feat/pwa",
    sessions: [
      { id: "s8", title: "PWA 主界面探索", project: "fastvibe", branch: "feat/pwa", time: "周日", state: "idle" },
    ],
  },
];

const ALL_SESSIONS = [...PINNED, ...GROUPS.flatMap((group) => group.sessions)];

const DIFF_LINES: { type: "add" | "del" | "ctx"; text: string }[] = [
  { type: "ctx", text: "--pane-radius: 16px;" },
  { type: "add", text: "--pane-radius: 22px;" },
  { type: "add", text: "--pane-shadow: 0 24px 60px -32px rgba(21, 46, 37, 0.35);" },
  { type: "ctx", text: "--pane-border: color-mix(in srgb, var(--border) 82%, transparent);" },
  { type: "del", text: "--shell-inset: 8px;" },
  { type: "add", text: "--shell-inset: 10px;" },
];

const CODE_LINES: { n: number; node: ReactNode }[] = [
  {
    n: 28,
    node: (
      <>
        <span className="tv-sel">[data-theme=<span className="tv-str">&quot;breeze&quot;</span>]</span> {"{"}
      </>
    ),
  },
  { n: 29, node: <><span className="tv-prop">  --bg</span>: <span className="tv-str">#f4f8f7</span>;</> },
  { n: 30, node: <><span className="tv-prop">  --bg-panel</span>: <span className="tv-str">#e9f0ee</span>;</> },
  { n: 31, node: <><span className="tv-prop">  --accent</span>: <span className="tv-str">#2f6b58</span>;</> },
  { n: 32, node: <><span className="tv-prop">  --user-bg</span>: <span className="tv-str">#e0efeb</span>;</> },
  { n: 33, node: <><span className="tv-prop">  --pane-radius</span>: <span className="tv-num">22px</span>;</> },
  { n: 34, node: <>{"}"}</> },
  { n: 35, node: <>&nbsp;</> },
  { n: 36, node: <><span className="tv-sel">.app-shell</span> {"{"}</> },
  { n: 37, node: <><span className="tv-prop">  gap</span>: <span className="tv-num">10px</span>;</> },
  { n: 38, node: <><span className="tv-prop">  padding</span>: <span className="tv-num">10px</span>;</> },
  { n: 39, node: <><span className="tv-prop">  background</span>: <span className="tv-key">var</span>(<span className="tv-prop">--bg-panel</span>);</> },
  { n: 40, node: <>{"}"}</> },
  { n: 41, node: <>&nbsp;</> },
  { n: 42, node: <><span className="tv-com">/* The conversation is one calm column. */</span></> },
];

export default function PreviewPage() {
  const [theme, setTheme] = useState<ThemeKey>("breeze");
  const [activeId, setActiveId] = useState("s1");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [filesOpen, setFilesOpen] = useState(true);

  const active = ALL_SESSIONS.find((session) => session.id === activeId) ?? ALL_SESSIONS[0];

  const sessionRow = (session: Session, child = false) => (
    <button
      key={session.id}
      type="button"
      className={`pv-row${child ? " is-child" : ""}${session.id === activeId ? " is-active" : ""}`}
      onClick={() => setActiveId(session.id)}
      title={session.title}
    >
      <span className={`pv-dot is-${session.state}`} />
      <span className="pv-row-title">{session.title}</span>
      <span className="pv-row-time">{session.time}</span>
    </button>
  );

  return (
    <div
      className={`pv-root${sidebarOpen ? "" : " is-side-collapsed"}${filesOpen ? "" : " is-files-closed"}`}
      data-theme={theme}
    >
      <div className="pv-rail">
        <div className="pv-rail-brand">
          <span className="pv-rail-dot" />
          Pi Web
          <span className="pv-rail-sub">网页预览 · 原型</span>
        </div>

        <div className="pv-themes" role="group" aria-label="主题">
          {THEMES.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`pv-theme${theme === item.key ? " is-active" : ""}`}
              onClick={() => setTheme(item.key)}
              title={item.label}
              aria-pressed={theme === item.key}
            >
              <span className="pv-swatch" style={{ background: item.swatch }} />
              <span className="pv-theme-label">{item.short}</span>
            </button>
          ))}
        </div>

        <div className="pv-rail-right">
          <span className="pv-rail-hint">对话示例</span>
          <Link className="pv-rail-link" href="/preview/pwa">
            <span>PWA 对话</span> <IconArrowRight size={13} />
          </Link>
        </div>
      </div>

      <div className="pv-stage">
        <aside className="pv-side pv-glass">
          <div className="pv-side-head">
            <div className="pv-brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/icon-192.png" alt="" width={26} height={26} className="pv-logo" />
              <div className="pv-brand-copy">
                <div className="pv-brand-name">Pi Web</div>
                <div className="pv-brand-sub">web 0.12 · pi 1.2.0</div>
              </div>
            </div>
            <button
              type="button"
              className="pv-icon-btn"
              title="收起侧栏"
              onClick={() => setSidebarOpen(false)}
            >
              <IconPanelLeft size={15} />
            </button>
          </div>

          <button type="button" className="pv-search">
            <IconSearch size={14} />
            <span>搜索会话</span>
            <kbd>⌘K</kbd>
          </button>

          <button type="button" className="pv-new">
            <IconPlus size={14} />
            <span>新建会话</span>
            <span className="pv-new-kbd">⌘N</span>
          </button>

          <div className="pv-side-scroll">
            <div className="pv-section-label">
              <IconPin size={10} /> 置顶
            </div>
            {PINNED.map((session) => sessionRow(session))}

            {GROUPS.map((group) => (
              <Fragment key={group.project}>
                <div className="pv-project">
                  <IconFolder size={13} />
                  <span className="pv-project-name">{group.project}</span>
                  <span className="pv-project-branch">{group.branch}</span>
                  <span className="pv-project-count">{group.sessions.length}</span>
                  <IconChevronDown size={11} />
                </div>
                {group.sessions.map((session) => sessionRow(session, true))}
              </Fragment>
            ))}
          </div>

          <div className="pv-side-foot">
            <button type="button" className="pv-foot-btn" onClick={() => setFilesOpen(true)}>
              <IconFiles size={14} /> 文件
            </button>
            <button type="button" className="pv-foot-btn">
              <IconSettings size={14} /> 设置
            </button>
            <span className="pv-avatar">我</span>
          </div>
        </aside>

        <main className="pv-main pv-glass">
          <header className="pv-main-head">
            <button
              type="button"
              className="pv-icon-btn"
              title={sidebarOpen ? "收起侧栏" : "展开侧栏"}
              onClick={() => setSidebarOpen((open) => !open)}
            >
              <IconPanelLeft size={15} />
            </button>

            <div className="pv-head-copy">
              <div className="pv-eyebrow">
                {active.project} <span>/</span> {active.branch}
              </div>
              <div className="pv-head-title">{active.title}</div>
            </div>

            <div className="pv-head-status">
              <span className="pv-live-dot" />
              运行中 <span className="pv-head-status-time">2 分 14 秒</span>
            </div>

            <div className="pv-capsule">
              <button type="button" className="pv-chip">
                <IconBranch size={13} />
                {active.branch}
                <IconChevronDown size={10} />
              </button>
              <span className="pv-capsule-div" />
              <button type="button" className="pv-icon-btn" title="终端">
                <IconTerminal size={14} />
              </button>
              <button
                type="button"
                className={`pv-icon-btn${filesOpen ? " is-on" : ""}`}
                title="文件面板"
                onClick={() => setFilesOpen((open) => !open)}
              >
                <IconFiles size={14} />
              </button>
              <button type="button" className="pv-icon-btn" title="更多">
                <IconMore size={14} />
              </button>
            </div>
          </header>

          <div className="pv-scroll">
            <div className="pv-thread">
              <div className="pv-user-row">
                <div className="pv-user-bubble">
                  用 Tivano 那种安静的玻璃语言重做 Pi Web 外壳——侧栏、顶栏和输入框。保持网页应用而不是 IDE，
                  并把同样的感觉带到 PWA 上。
                </div>
              </div>

              <div className="pv-assistant">
                <div className="pv-model-row">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/icons/icon-192.png" alt="" width={18} height={18} className="pv-model-logo" />
                  <span className="pv-model-name">Pi</span>
                  <span className="pv-model-dim">·</span>
                  <span>Claude Sonnet 4.6</span>
                  <span className="pv-msg-time">13:42</span>
                </div>

                <button type="button" className="pv-thought">
                  <IconSparkle size={13} />
                  思考了 8 秒
                  <IconChevronRight size={11} />
                </button>

                <div className="pv-prose">
                  <p>
                    我把当前外壳映射到了参考语言上。Tivano 的安静感来自三点：<strong>单一对话列</strong>
                    、让玻璃染上色调而不是刷漆的面，以及像胶囊一样浮起而不是排成仪表盘的控件。
                  </p>
                  <p>
                    在网页上这变成一个漂浮的工作区——侧栏、对话和文件分别作为玻璃窗格，浮在柔和的 Breeze
                    底色上。PWA 保留 FastVibe 那种扁平分组列表，让手机端第一眼是列表、其次是对话。
                  </p>
                </div>

                <div className="pv-plan">
                  <div className="pv-plan-head">
                    <IconList size={13} />
                    计划
                    <span className="pv-plan-count">3/4</span>
                  </div>
                  <ul>
                    <li className="is-done">
                      <span className="pv-check"><IconCheck size={9} /></span>
                      读当前外壳与主题 token
                    </li>
                    <li className="is-done">
                      <span className="pv-check"><IconCheck size={9} /></span>
                      起草玻璃表面的 token
                    </li>
                    <li className="is-done">
                      <span className="pv-check"><IconCheck size={9} /></span>
                      重做侧栏、顶栏和输入框
                    </li>
                    <li className="is-active">
                      <span className="pv-spinner" />
                      打磨空状态和 PWA 列表
                    </li>
                  </ul>
                </div>

                <div className="pv-tool">
                  <div className="pv-tool-head">
                    <span className="pv-tool-icon"><IconFile size={12} /></span>
                    <span className="pv-tool-title">读取 app/globals.css</span>
                    <span className="pv-tool-detail">1,284 行</span>
                    <IconChevronRight size={11} className="pv-tool-chevron" />
                  </div>
                </div>

                <div className="pv-tool is-open">
                  <div className="pv-tool-head">
                    <span className="pv-tool-icon"><IconFile size={12} /></span>
                    <span className="pv-tool-title">编辑 app/globals.css</span>
                    <span className="pv-tool-detail">+3 −2</span>
                    <IconChevronDown size={11} className="pv-tool-chevron" />
                  </div>
                  <div className="pv-diff">
                    {DIFF_LINES.map((line, index) => (
                      <div key={`${line.type}-${index}`} className={`pv-diff-line is-${line.type}`}>
                        <span className="sign">{line.type === "add" ? "+" : line.type === "del" ? "−" : ""}</span>
                        <span>{line.text}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pv-tool">
                  <div className="pv-tool-head">
                    <span className="pv-tool-icon"><IconFile size={12} /></span>
                    <span className="pv-tool-title">编辑 app/preview/page.tsx</span>
                    <span className="pv-tool-detail">+512 −0</span>
                    <IconChevronUp size={11} className="pv-tool-chevron" />
                  </div>
                </div>

                <div className="pv-prose">
                  <p>
                    玻璃色调和输入框的浮起标签已经就位。接下来我会对着窗口底色调校浅色 Breeze
                    调色板，然后是 PWA 的分组列表。
                    <span className="pv-caret" />
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="pv-minimap" aria-hidden="true">
            <i style={{ width: "42%" }} />
            <i style={{ width: "68%" }} />
            <i style={{ width: "55%" }} />
            <i style={{ width: "76%" }} />
            <i style={{ width: "38%" }} />
            <i style={{ width: "62%" }} />
            <i style={{ width: "48%" }} />
          </div>

          <div className="pv-composer-shell">
            <div className="pv-composer-wrap">
              <button type="button" className="pv-change-tab">
                <span className="pv-change-icon"><IconFile size={10} /></span>
                3 个文件已更改
                <span className="pv-plus">+538</span>
                <span className="pv-minus">−46</span>
                <IconChevronUp size={10} />
              </button>

              <div className="pv-composer">
                <textarea
                  rows={1}
                  placeholder="让 pi 继续完善这个设计…"
                  aria-label="给 pi 发送消息"
                />
                <div className="pv-composer-controls">
                  <button type="button" className="pv-tool-btn" title="添加附件">
                    <IconPaperclip size={14} />
                  </button>
                  <button type="button" className="pv-tool-btn" title="引用文件">
                    <IconAt size={14} />
                  </button>
                  <span className="pv-grow" />
                  <button type="button" className="pv-select is-model">
                    <IconSparkle size={12} />
                    Claude Sonnet 4.6
                    <IconChevronDown size={10} />
                  </button>
                  <button type="button" className="pv-select is-effort">
                    <span className="pv-effort" />
                    中等
                  </button>
                  <button type="button" className="pv-select is-tools">
                    构建
                    <IconChevronDown size={10} />
                  </button>
                  <button type="button" className="pv-send" title="发送">
                    <IconArrowUp size={15} />
                  </button>
                </div>
              </div>

              <div className="pv-composer-meta">
                <span className="pv-meta-left">
                  <span className="pv-live-dot" />
                  pi 1.2.0 · 已连接
                </span>
                <span className="pv-meta-right">8.4k tokens · $0.42</span>
              </div>
            </div>
          </div>
        </main>

        <aside className="pv-files pv-glass">
          <header className="pv-files-head">
            <button type="button" className="pv-tab is-active">文件</button>
            <button type="button" className="pv-tab">
              更改 <span className="pv-badge">3</span>
            </button>
            <span className="pv-grow" />
            <button type="button" className="pv-icon-btn" title="关闭面板" onClick={() => setFilesOpen(false)}>
              <IconClose size={13} />
            </button>
          </header>

          <div className="pv-files-scroll">
            <div className="pv-tree">
              <div className="pv-tree-row is-folder">
                <IconChevronDown size={10} />
                <IconFolder size={12} /> app
              </div>
              <div className="pv-tree-row is-indent">
                <IconChevronDown size={10} />
                <IconFolder size={12} /> preview
              </div>
              <div className="pv-tree-row is-file is-indent-2">
                <IconFile size={12} /> page.tsx <span className="pv-mark">M</span>
              </div>
              <div className="pv-tree-row is-file is-indent is-selected">
                <IconFile size={12} /> globals.css <span className="pv-mark">M</span>
              </div>
              <div className="pv-tree-row is-file is-indent">
                <IconFile size={12} /> sidebar.css <span className="pv-mark">M</span>
              </div>
              <div className="pv-tree-row is-folder">
                <IconChevronRight size={10} />
                <IconFolder size={12} /> components
              </div>
              <div className="pv-tree-row is-folder">
                <IconChevronRight size={10} />
                <IconFolder size={12} /> lib
              </div>
              <div className="pv-tree-row is-folder">
                <IconChevronDown size={10} />
                <IconFolder size={12} /> public
              </div>
              <div className="pv-tree-row is-file is-indent">
                <IconFile size={12} /> manifest.webmanifest
              </div>
            </div>

            <div className="pv-editor">
              <div className="pv-editor-head">
                <IconFile size={11} /> app/globals.css
                <span className="pv-lang">CSS</span>
              </div>
              <div className="pv-code">
                {CODE_LINES.map((line) => (
                  <div key={line.n} className="pv-code-line">
                    <span className="pv-ln">{line.n}</span>
                    <code>{line.node}</code>
                  </div>
                ))}
              </div>
            </div>

            <div className="pv-file-foot">
              <IconBranch size={11} /> {active.branch} <span>·</span> 无改动
              <span className="pv-grow" />
              UTF-8
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
