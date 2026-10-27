"use client";

import Link from "next/link";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { PwaSessionsPanel, type PwaSession } from "./sessions-panel";
import {
  IconArchive,
  IconArrowRight,
  IconAt,
  IconBrain,
  IconBranch,
  IconChanges,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconClose,
  IconDot,
  IconExpand,
  IconFile,
  IconFork,
  IconList,
  IconMenu,
  IconMoon,
  IconOpenInNewTab,
  IconPanelLeft,
  IconPanelRight,
  IconPaperclip,
  IconPencil,
  IconPinOff,
  IconRefresh,
  IconSparkle,
  IconSun,
  IconTerminal,
  IconTrash,
  IconUpload,
} from "../icons";

type PwaTheme = "light" | "dark";
type PanelTab = "files" | "changes";

const DIFF_LINES: { type: "add" | "del" | "ctx"; text: string }[] = [
  { type: "ctx", text: "--pane-radius: 16px;" },
  { type: "add", text: "--pane-radius: 22px;" },
  { type: "add", text: "--pane-shadow: 0 24px 60px -32px rgba(21, 46, 37, 0.35);" },
  { type: "ctx", text: "--pane-border: color-mix(in srgb, var(--border) 82%, transparent);" },
  { type: "del", text: "--shell-inset: 8px;" },
  { type: "add", text: "--shell-inset: 10px;" },
];

type TreeRow = {
  name: string;
  depth: number;
  dir?: boolean;
  open?: boolean;
  change?: "M" | "A";
  stat?: string;
};

const TREE: TreeRow[] = [
  { name: "app", depth: 0, dir: true, open: true },
  { name: "preview", depth: 1, dir: true, open: true },
  { name: "page.tsx", depth: 2, change: "M", stat: "+412 −18" },
  { name: "preview.css", depth: 2, change: "M", stat: "+98 −22" },
  { name: "pwa", depth: 2, dir: true, open: true },
  { name: "page.tsx", depth: 3, change: "M", stat: "+28 −6" },
  { name: "components", depth: 0, dir: true, open: false },
  { name: "lib", depth: 0, dir: true, open: false },
  { name: "package.json", depth: 0 },
];

const CHANGES = [
  { name: "app/preview/page.tsx", add: "+412", del: "−18" },
  { name: "app/preview/preview.css", add: "+98", del: "−22" },
  { name: "app/preview/pwa/page.tsx", add: "+28", del: "−6" },
];

export default function PwaChatPreviewPage() {
  const [theme, setTheme] = useState<PwaTheme>("light");
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(true);
  const [diffOpen, setDiffOpen] = useState(true);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>("files");
  const [menuSession, setMenuSession] = useState<PwaSession | null>(null);
  const [sheetDragY, setSheetDragY] = useState(0);
  const sheetDragRef = useRef<{ startY: number } | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastUserRef = useRef<HTMLDivElement | null>(null);
  const dark = theme === "dark";

  // Open on the latest exchange rather than at the very top of the history:
  // the last prompt sits just under the bar, the live turn runs to the footer.
  // The anchor is re-applied once layout settles (logo image, wrap of the
  // last paragraph), exactly as a chat scroll-to-bottom does after a render.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const anchor = () => {
      const anchorEl = lastUserRef.current;
      if (!anchorEl) {
        element.scrollTop = element.scrollHeight;
        return;
      }
      const top =
        anchorEl.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop - 8;
      element.scrollTop = Math.max(0, top);
    };
    anchor();
    const frame = requestAnimationFrame(() => requestAnimationFrame(anchor));
    const timer = window.setTimeout(anchor, 280);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, []);

  // Pi Web's phone layout is two overlaid panels: opening one closes the other.
  const openLeft = () => {
    setLeftOpen(true);
    setRightOpen(false);
  };
  const openRight = () => {
    setRightOpen(true);
    setLeftOpen(false);
  };

  // The row menu of the sessions panel: Pi Web's sidebar menu, which is a
  // bottom sheet on phones. Drag it down to dismiss, as iOS sheets do.
  const closeMenu = () => {
    setMenuSession(null);
    setSheetDragY(0);
  };
  const onSheetPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    sheetDragRef.current = { startY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onSheetPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!sheetDragRef.current) return;
    setSheetDragY(Math.max(0, event.clientY - sheetDragRef.current.startY));
  };
  const onSheetPointerEnd = () => {
    if (!sheetDragRef.current) return;
    sheetDragRef.current = null;
    if (sheetDragY > 90) closeMenu();
    else setSheetDragY(0);
  };

  return (
    <div className="pw-root" data-theme={theme}>
      <div className="pw-stage">
        <div className="pw-caption">
          <span className="pw-caption-brand">
            <span className="pw-caption-dot" />
            Pi Web · PWA 对话
          </span>
          <span className="pw-caption-note">对话 + 左侧会话栏 / 右上角开关右侧面板</span>
          <Link className="pw-caption-link" href="/preview">
            网页预览 <IconArrowRight size={13} />
          </Link>
        </div>

        <div className="pw-phone is-chat">
          <div className="pw-island" />

          <div className="pw-status">
            <span className="pw-status-time">9:41</span>
            <span className="pw-status-icons">
              <svg width="17" height="11" viewBox="0 0 17 11" aria-hidden="true">
                <rect x="0" y="7" width="3" height="4" rx="1" fill="currentColor" />
                <rect x="4.6" y="5" width="3" height="6" rx="1" fill="currentColor" />
                <rect x="9.2" y="2.5" width="3" height="8.5" rx="1" fill="currentColor" />
                <rect x="13.8" y="0" width="3" height="11" rx="1" fill="currentColor" />
              </svg>
              <svg width="15" height="11" viewBox="0 0 15 11" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M1.2 3.4a9.5 9.5 0 0 1 12.6 0M3.7 6a6 6 0 0 1 7.6 0M6.2 8.6a2.6 2.6 0 0 1 2.6 0" />
              </svg>
              <svg width="23" height="11" viewBox="0 0 23 11" aria-hidden="true">
                <rect x="0.5" y="0.5" width="19" height="10" rx="3" fill="none" stroke="currentColor" opacity="0.45" />
                <rect x="2" y="2" width="14" height="7" rx="1.6" fill="currentColor" />
                <path d="M21 3.6v3.8a2 2 0 0 0 0-3.8Z" fill="currentColor" opacity="0.45" />
              </svg>
            </span>
          </div>

          <div className="pwchat-shell">
            <header className={`pwchat-bar${scrolled ? " is-scrolled" : ""}`}>
              <button
                type="button"
                className={`pwchat-bar-btn${leftOpen ? " is-active" : ""}`}
                title={leftOpen ? "收起会话" : "打开会话"}
                aria-expanded={leftOpen}
                onClick={() => (leftOpen ? setLeftOpen(false) : openLeft())}
              >
                {leftOpen ? <IconPanelLeft size={16} /> : <IconMenu size={17} />}
              </button>

              <div className="pwchat-bar-copy">
                <div className="pwchat-eyebrow">
                  pi-web <span>/</span> main
                </div>
                <div className="pwchat-bar-title">重做 Pi Web 外壳</div>
                <div className="pwchat-bar-sub">
                  <span className="pw-dot is-running" />
                  运行中 · 2 分 14 秒
                </div>
              </div>

              <div className="pwchat-capsule">
                <button type="button" className="pwchat-capsule-chip" title="切换分支">
                  <IconBranch size={12} />
                  main
                  <IconChevronDown size={11} />
                </button>
                <span className="pwchat-capsule-div" />
                <button
                  type="button"
                  className={`pwchat-bar-btn${rightOpen ? " is-active" : ""}`}
                  title={rightOpen ? "关闭文件面板" : "打开文件面板"}
                  aria-expanded={rightOpen}
                  onClick={() => (rightOpen ? setRightOpen(false) : openRight())}
                >
                  <IconPanelRight size={16} />
                </button>
              </div>
            </header>

            <div className="pwchat-body">
              <div
                className="pwchat-scroll"
                ref={scrollRef}
                onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 6)}
              >
                <div className="pwchat-thread">
                  <div className="pwchat-divider">
                    <span>今天 13:42</span>
                  </div>

                  <div className="pwchat-user-row">
                    <div className="pwchat-bubble">
                      让手机端和桌面预览保持一致：同样的玻璃工作区、每次工具调用一张卡片、输入框浮在内容上方。
                    </div>
                  </div>

                  <div className="pwchat-assistant">
                    <div className="pwchat-byline">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/icons/icon-192.png" alt="" width={17} height={17} className="pwchat-byline-logo" />
                      <span className="pwchat-byline-name">Pi</span>
                      <span className="pwchat-byline-model">Claude Sonnet 4.6</span>
                      <span className="pwchat-turn-meta">13:42</span>
                    </div>

                    <button
                      type="button"
                      className={`pwchat-thought${thinkingOpen ? " is-open" : ""}`}
                      onClick={() => setThinkingOpen((open) => !open)}
                      aria-expanded={thinkingOpen}
                    >
                      <IconSparkle size={13} />
                      思考了 8 秒
                      <IconChevronRight size={11} className="pwchat-thought-chevron" />
                    </button>

                    {thinkingOpen && (
                      <div className="pwchat-thinking-body">
                        桌面端读起来像一个工作区，是因为窗格从页面里内缩，每一步都有自己的卡片。到手机上就变成同样的内嵌外壳、每次调用一张工具卡，以及唯一凸起的输入框。
                      </div>
                    )}

                    <div className="pwchat-prose">
                      <p>
                        我把桌面端的外壳映射到了手机上。Tivano 的安静感来自三点：<strong>单一对话列</strong>
                        、让玻璃染上色调而不是刷漆的面，以及像胶囊一样浮起的控件。
                      </p>
                      <p>
                        所以手机端保留页面底色，在其上内嵌一个玻璃工作区，并给每次工具调用它桌面上拥有的卡片。
                      </p>
                    </div>

                    <div className="pwchat-plan">
                      <button
                        type="button"
                        className="pwchat-plan-head"
                        onClick={() => setPlanOpen((open) => !open)}
                        aria-expanded={planOpen}
                      >
                        <IconList size={13} />
                        计划
                        <span className="pwchat-plan-count">3/4</span>
                        {planOpen ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
                      </button>

                      {planOpen && (
                        <div className="pwchat-checklist">
                          <div className="pwchat-check is-done">
                            <span className="pwchat-check-mark"><IconCheck size={9} /></span>
                            把桌面窗格镜像成内嵌外壳
                          </div>
                          <div className="pwchat-check is-done">
                            <span className="pwchat-check-mark"><IconCheck size={9} /></span>
                            把过程卡拆成逐次调用的卡片
                          </div>
                          <div className="pwchat-check is-done">
                            <span className="pwchat-check-mark"><IconCheck size={9} /></span>
                            让输入框浮在薄雾之上
                          </div>
                          <div className="pwchat-check is-active">
                            <span className="pwchat-check-spinner" />
                            会话与文件作为两个侧面板
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="pwchat-tools">
                      <div className="pwchat-tool">
                        <div className="pwchat-tool-head">
                          <span className="pwchat-tool-icon"><IconFile size={12} /></span>
                          <span className="pwchat-tool-title">读取 app/globals.css</span>
                          <span className="pwchat-tool-detail">1,284 行</span>
                          <IconChevronRight size={11} className="pwchat-tool-chevron" />
                        </div>
                      </div>

                      <div className={`pwchat-tool${diffOpen ? " is-open" : ""}`}>
                        <button
                          type="button"
                          className="pwchat-tool-head"
                          onClick={() => setDiffOpen((open) => !open)}
                          aria-expanded={diffOpen}
                        >
                          <span className="pwchat-tool-icon"><IconFile size={12} /></span>
                          <span className="pwchat-tool-title">编辑 app/globals.css</span>
                          <span className="pwchat-tool-detail">+3 −2</span>
                          <IconChevronRight size={11} className="pwchat-tool-chevron" />
                        </button>

                        {diffOpen && (
                          <div className="pwchat-diff">
                            {DIFF_LINES.map((line, index) => (
                              <div key={`${line.type}-${index}`} className={`pwchat-diff-line is-${line.type}`}>
                                <span className="sign">
                                  {line.type === "add" ? "+" : line.type === "del" ? "−" : ""}
                                </span>
                                <span>{line.text}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="pwchat-tool">
                        <div className="pwchat-tool-head">
                          <span className="pwchat-tool-icon"><IconFile size={12} /></span>
                          <span className="pwchat-tool-title">编辑 app/preview/page.tsx</span>
                          <span className="pwchat-tool-detail">+512 −0</span>
                          <IconChevronUp size={11} className="pwchat-tool-chevron" />
                        </div>
                      </div>
                    </div>

                    <div className="pwchat-prose">
                      <p>
                        玻璃色调和输入框的浮起标签已经就位。接下来我会对着窗口底色调校浅色 Breeze
                        调色板，然后是图标集。
                        <span className="pv-caret" />
                      </p>
                    </div>
                  </div>

                  <div className="pwchat-user-row" ref={lastUserRef}>
                    <div className="pwchat-bubble">
                      把运行状态留在视野里——我想一边读一边看到它在做什么。
                    </div>
                  </div>

                  <div className="pwchat-assistant">
                    <div className="pwchat-byline">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/icons/icon-192.png" alt="" width={17} height={17} className="pwchat-byline-logo" />
                      <span className="pwchat-byline-name">Pi</span>
                      <span className="pwchat-byline-model">Claude Sonnet 4.6</span>
                      <span className="pwchat-turn-meta">13:44</span>
                    </div>

                    <div className="pwchat-tools">
                      <div className="pwchat-tool">
                        <div className="pwchat-tool-head">
                          <span className="pwchat-tool-icon"><IconFile size={12} /></span>
                          <span className="pwchat-tool-title">读取 app/preview/preview.css</span>
                          <span className="pwchat-tool-detail">3,245 行</span>
                          <IconChevronRight size={11} className="pwchat-tool-chevron" />
                        </div>
                      </div>

                      <div className="pwchat-tool is-shell">
                        <div className="pwchat-tool-head">
                          <span className="pwchat-tool-icon"><IconTerminal size={12} /></span>
                          <span className="pwchat-tool-title">pnpm typecheck</span>
                          <span className="pwchat-tool-detail">通过</span>
                          <IconChevronRight size={11} className="pwchat-tool-chevron" />
                        </div>
                      </div>
                    </div>

                    <div className="pwchat-prose">
                      <p>
                        好了。运行胶囊停在输入框上方并显示已用时间，运行期间操作按钮会变成停止按钮。
                      </p>
                      <p>
                        上下文环显示 38%，超过 70% 会变成琥珀色，让长对话在截断前先给出警告。点一下可以看到确切的
                        token 数。
                      </p>
                      <p className="pwchat-streaming">
                        接下来我检查安全区域和键盘抬起。
                        <span className="pv-caret" />
                      </p>
                    </div>

                    <button type="button" className="pwchat-changes" onClick={() => openRight()}>
                      <IconChanges size={13} />
                      <span>3 个文件已更改</span>
                      <span className="pwchat-diffstat">
                        <span className="is-add">+538</span>
                        <span className="is-del">−46</span>
                      </span>
                      <IconChevronRight size={13} className="pwchat-changes-chevron" />
                    </button>

                    <div className="pwchat-turn-meta">2 分 14 秒 · 8.4k tokens · $0.42</div>
                  </div>
                </div>
              </div>

              <footer className="pwchat-footer">
                <div className="pwchat-working">
                  <span className="pwchat-working-dots">
                    <i />
                    <i />
                    <i />
                  </span>
                  运行中 · 2 分 14 秒
                </div>

                <div className="pwchat-composer">
                  <textarea rows={1} placeholder="让 pi 继续完善这个设计…" aria-label="给 pi 发送消息" />
                  <div className="pwchat-controls">
                    <button type="button" className="pwchat-attach" title="添加附件">
                      <IconPaperclip size={15} />
                    </button>
                    <button type="button" className="pwchat-attach" title="引用文件">
                      <IconAt size={15} />
                    </button>

                    <div className="pwchat-chips">
                      <button type="button" className="pwchat-chip">
                        <span className="pwchat-chip-avatar">
                          <IconSparkle size={11} />
                        </span>
                        <span className="pwchat-chip-label">Sonnet 4.6</span>
                      </button>
                      <button type="button" className="pwchat-chip">
                        <IconBrain size={13} />
                        <span className="pwchat-chip-label">中等</span>
                      </button>
                    </div>

                    <span className="pwchat-context" title="上下文 38%">
                      <svg width="20" height="20" viewBox="0 0 22 22" aria-hidden="true">
                        <circle cx="11" cy="11" r="8.7" fill="none" stroke="var(--pw-border)" strokeWidth="2.6" />
                        <circle
                          cx="11"
                          cy="11"
                          r="8.7"
                          fill="none"
                          stroke="var(--pw-accent)"
                          strokeWidth="2.6"
                          strokeLinecap="round"
                          strokeDasharray="21 34"
                          transform="rotate(-90 11 11)"
                        />
                      </svg>
                    </span>

                    <button type="button" className="pwchat-stop" title="停止">
                      <span />
                    </button>
                  </div>
                </div>

                <div className="pwchat-composer-meta">
                  <span className="pw-dot is-running" />
                  pi 1.2.0 · 已连接
                  <span className="pwchat-meta-right">8.4k tokens · $0.42</span>
                </div>
              </footer>
            </div>
          </div>

          {/* Left panel: the sessions sidebar. */}
          {leftOpen && (
            <div className="pwdrawer-layer">
              <button
                type="button"
                className="pwdrawer-backdrop"
                aria-label="关闭会话面板"
                onClick={() => setLeftOpen(false)}
              />
              <aside className="pwdrawer is-left" aria-label="会话">
                <PwaSessionsPanel
                  onClose={() => setLeftOpen(false)}
                  onPick={() => setLeftOpen(false)}
                  onOpenMenu={setMenuSession}
                />
              </aside>
            </div>
          )}

          {/* Right panel: files only, as Pi Web's own file panel. */}
          {rightOpen && (
            <div className="pwdrawer-layer">
              <button
                type="button"
                className="pwdrawer-backdrop"
                aria-label="关闭文件面板"
                onClick={() => setRightOpen(false)}
              />
              <aside className="pwdrawer is-right" aria-label="文件面板">
                <header className="pwpanel-head">
                  <div className="pwpanel-tabs" role="tablist" aria-label="文件面板">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={panelTab === "files"}
                      className={panelTab === "files" ? "is-active" : ""}
                      onClick={() => setPanelTab("files")}
                    >
                      文件
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={panelTab === "changes"}
                      className={panelTab === "changes" ? "is-active" : ""}
                      onClick={() => setPanelTab("changes")}
                    >
                      更改 <span>{CHANGES.length}</span>
                    </button>
                  </div>
                  <div className="pwpanel-actions">
                    <button type="button" title="展开面板">
                      <IconExpand size={15} />
                    </button>
                    <button type="button" title="上传文件">
                      <IconUpload size={15} />
                    </button>
                    <button type="button" title="刷新">
                      <IconRefresh size={15} />
                    </button>
                    <button type="button" title="关闭文件面板" onClick={() => setRightOpen(false)}>
                      <IconClose size={15} />
                    </button>
                  </div>
                </header>

                <div className="pwpanel-scroll">
                  {panelTab === "files" ? (
                    TREE.map((row) => (
                      <button
                        key={`${row.depth}-${row.name}-${row.dir ? "d" : "f"}`}
                        type="button"
                        className={`pw-tree-row${row.dir ? " is-dir" : ""}${row.change ? " is-changed" : ""}`}
                        style={{ paddingLeft: 8 + row.depth * 14 }}
                      >
                        {row.dir ? (
                          <IconChevronRight
                            size={12}
                            className={`pw-tree-chevron${row.open ? " is-open" : ""}`}
                          />
                        ) : (
                          <IconFile size={12} className="pw-tree-file" />
                        )}
                        <span className="pw-tree-name">{row.name}</span>
                        {row.change && (
                          <span className="pw-tree-meta">
                            <span className={`pw-tree-badge is-${row.change.toLowerCase()}`}>{row.change}</span>
                            {row.stat}
                          </span>
                        )}
                      </button>
                    ))
                  ) : (
                    CHANGES.map((row) => (
                      <button key={row.name} type="button" className="pwchange-row">
                        <IconFile size={12} />
                        <span className="pwchange-name">{row.name}</span>
                        <span className="pwchange-stat">
                          <span className="is-add">{row.add}</span>
                          <span className="is-del">{row.del}</span>
                        </span>
                      </button>
                    ))
                  )}
                </div>

                <footer className="pwpanel-foot">
                  <button type="button" className="pwpanel-foot-row">
                    <IconTerminal size={14} />
                    终端
                    <IconChevronRight size={12} className="pw-tree-chevron" />
                  </button>
                  <span className="pwpanel-foot-meta">pi-web · main</span>
                </footer>
              </aside>
            </div>
          )}

          {/* A session row's own menu: a bottom sheet over the sidebar. */}
          {menuSession && (
            <div className="pwchat-sheet-layer">
              <button
                type="button"
                className="pwchat-sheet-backdrop"
                aria-label="关闭会话菜单"
                onClick={closeMenu}
              />
              <div
                className="pwchat-sheet"
                role="dialog"
                aria-label={`${menuSession.title} · 会话操作`}
                style={{
                  translate: sheetDragY ? `0 ${sheetDragY}px` : undefined,
                  transition: sheetDragY ? "none" : undefined,
                }}
              >
                <div
                  className="pwchat-sheet-grab"
                  onPointerDown={onSheetPointerDown}
                  onPointerMove={onSheetPointerMove}
                  onPointerUp={onSheetPointerEnd}
                  onPointerCancel={onSheetPointerEnd}
                />
                <div className="pwchat-sheet-title">此会话</div>
                <button type="button" className="pwchat-sheet-row" onClick={closeMenu}>
                  <IconPinOff size={15} /> 取消置顶
                </button>
                <button type="button" className="pwchat-sheet-row" onClick={closeMenu}>
                  <IconPencil size={15} /> 重命名
                </button>
                <button type="button" className="pwchat-sheet-row" onClick={closeMenu}>
                  <IconFork size={15} /> 分叉会话
                </button>
                <button type="button" className="pwchat-sheet-row" onClick={closeMenu}>
                  <IconDot size={15} /> 标为未读
                </button>
                <button type="button" className="pwchat-sheet-row" onClick={closeMenu}>
                  <IconArchive size={15} /> 归档
                </button>
                <button type="button" className="pwchat-sheet-row" onClick={closeMenu}>
                  <IconOpenInNewTab size={15} /> 在新标签页打开
                </button>
                <button type="button" className="pwchat-sheet-row is-danger" onClick={closeMenu}>
                  <IconTrash size={15} /> 删除
                </button>

                <div className="pwchat-sheet-title">外观</div>
                <button
                  type="button"
                  className="pwchat-sheet-row"
                  onClick={() => {
                    setTheme(dark ? "light" : "dark");
                    closeMenu();
                  }}
                >
                  {dark ? <IconSun size={15} /> : <IconMoon size={15} />}
                  切换到{dark ? "浅色" : "深色"}主题
                </button>
              </div>
            </div>
          )}

          <div className="pw-home" />
        </div>
      </div>
    </div>
  );
}
