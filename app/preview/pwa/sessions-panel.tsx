"use client";

import Link from "next/link";
import { useState } from "react";
import {
  IconArchive,
  IconChevronDown,
  IconClock,
  IconClose,
  IconFolder,
  IconMore,
  IconPin,
  IconPlus,
  IconSearch,
  IconSettings,
} from "../icons";

export type PwaSession = {
  id: string;
  title: string;
  project: string;
  time: string;
  state: "running" | "waiting" | "idle";
};

type Filter = "all" | "active" | "waiting";

const PINNED: PwaSession = {
  id: "p1",
  title: "打磨 MCP OAuth 登录",
  project: "pi-web",
  time: "1 小时",
  state: "waiting",
};

const TODAY: PwaSession[] = [
  { id: "t1", title: "会话侧栏：置顶与归档", project: "pi-web", time: "3 小时", state: "idle" },
  { id: "t2", title: "Breeze 主题对比度调整", project: "tivano", time: "5 小时", state: "idle" },
];

const YESTERDAY: PwaSession[] = [
  { id: "y1", title: "PWA 主界面探索", project: "fastvibe", time: "昨天", state: "idle" },
  { id: "y2", title: "Hydra 合并评审", project: "tivano", time: "昨天", state: "idle" },
];

const ALL_COUNT = 1 + 1 + TODAY.length + YESTERDAY.length;

function SessionCard({
  session,
  onPick,
  onOpenMenu,
}: {
  session: PwaSession;
  onPick: () => void;
  onOpenMenu: (session: PwaSession) => void;
}) {
  return (
    <div className="pw-card-wrap">
      <Link className="pw-card-link" href="/preview/pwa" onClick={onPick}>
        <article className="pw-card">
          <div className="pw-row">
            <div className="pw-row-main">
              <div className="pw-row-title">{session.title}</div>
              <div className="pw-row-meta">
                <span className="pw-project-chip">
                  <IconFolder size={10} />
                  {session.project}
                </span>
                <span className={`pw-dot is-${session.state}`} />
                <span>{session.time}</span>
                {session.state === "waiting" && <span className="pw-wait">需要输入</span>}
              </div>
            </div>
          </div>
        </article>
      </Link>
      <button
        type="button"
        className="pw-card-more"
        title="会话操作"
        aria-label={`${session.title} · 会话操作`}
        aria-haspopup="menu"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenMenu(session);
        }}
      >
        <IconMore size={15} />
      </button>
    </div>
  );
}

/**
 * The sessions sidebar, the same tree the desktop keeps on the left: brand,
 * search, project picker, pinned/today/groups, and the bottom toolbar. It is a
 * panel, not a page — the chat never leaves the screen behind it. Every saved
 * row carries its own ⋯, which opens the row menu as a bottom sheet.
 */
export function PwaSessionsPanel({
  onClose,
  onPick,
  onOpenMenu,
}: {
  onClose: () => void;
  onPick: () => void;
  onOpenMenu: (session: PwaSession) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [compact, setCompact] = useState(false);

  const showRunning = filter !== "waiting";
  const showWaiting = filter !== "active";
  const showIdle = filter === "all";

  return (
    <>
      <header className={`pw-head${compact ? " is-compact" : ""}`}>
        <div className="pw-head-row">
          <div className="pw-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="" width={26} height={26} className="pw-logo" />
            <span className="pw-brand-name">Pi</span>
            <span className="pw-brand-web">web</span>
          </div>
          <div className="pw-head-actions">
            <button type="button" className="pw-icon-btn" title="归档">
              <IconArchive size={16} />
            </button>
            <button type="button" className="pw-icon-btn" title="设置">
              <IconSettings size={16} />
            </button>
            <button type="button" className="pw-icon-btn" title="收起会话" onClick={onClose}>
              <IconClose size={16} />
            </button>
          </div>
        </div>

        <div className="pw-title-row">
          <h1 className="pw-title">会话</h1>
          <span className="pw-title-meta">{ALL_COUNT}</span>
        </div>
        <p className="pw-sub">3 个项目 · 1 个运行中 · 1 个等待中</p>

        <div className="pw-search">
          <IconSearch size={14} />
          <span>搜索会话</span>
          <button type="button" className="pw-project-select">
            <IconFolder size={11} />
            全部项目
            <IconChevronDown size={10} />
          </button>
        </div>
      </header>

      <div className="pw-scroll" onScroll={(event) => setCompact(event.currentTarget.scrollTop > 18)}>
        {showRunning && (
          <section className="pw-section pw-section-first">
            <div className="pw-section-head">
              继续
              <span className="pw-section-count">1 个运行中</span>
            </div>
            <div className="pw-card-wrap">
              <Link className="pw-card-link" href="/preview/pwa" onClick={onPick}>
                <article className="pw-card pw-continue">
                  <div className="pw-continue-top">
                    <span className="pw-pill is-live">
                      <span className="pw-dot is-running" />
                      运行中
                    </span>
                  </div>
                  <h2 className="pw-continue-title">重做 Pi Web 外壳</h2>
                  <div className="pw-row-meta">
                    <span className="pw-project-chip">
                      <IconFolder size={10} />
                      pi-web
                    </span>
                    <span>正在编辑 app/preview/page.tsx</span>
                    <span className="pw-continue-time">2 分</span>
                  </div>
                  <div className="pw-progress-row">
                    <span className="pw-progress">
                      <i />
                    </span>
                    <span className="pw-progress-label">62%</span>
                  </div>
                </article>
              </Link>
              <button
                type="button"
                className="pw-card-more is-top"
                title="会话操作"
                aria-label="重做 Pi Web 外壳 · 会话操作"
                aria-haspopup="menu"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenMenu({ id: "s1", title: "重做 Pi Web 外壳", project: "pi-web", time: "2 分", state: "running" });
                }}
              >
                <IconMore size={15} />
              </button>
            </div>
          </section>
        )}

        {showWaiting && (
          <section className="pw-section">
            <div className="pw-section-head">
              <IconPin size={10} />
              置顶
            </div>
            <SessionCard session={PINNED} onPick={onPick} onOpenMenu={onOpenMenu} />
          </section>
        )}

        {showIdle && (
          <section className="pw-section">
            <div className="pw-section-head">
              今天
              <span className="pw-section-count">{TODAY.length}</span>
            </div>
            {TODAY.map((session) => (
              <SessionCard key={session.id} session={session} onPick={onPick} onOpenMenu={onOpenMenu} />
            ))}
          </section>
        )}

        {showIdle && (
          <section className="pw-section">
            <div className="pw-section-head">
              昨天
              <span className="pw-section-count">{YESTERDAY.length}</span>
            </div>
            {YESTERDAY.map((session) => (
              <SessionCard key={session.id} session={session} onPick={onPick} onOpenMenu={onOpenMenu} />
            ))}
          </section>
        )}

        {filter !== "all" && !showRunning && !showIdle && (
          <div className="pw-empty">
            <IconClock size={18} />
            <span>{filter === "waiting" ? "没有其他等待中的会话。" : "没有其他运行中的会话。"}</span>
          </div>
        )}
      </div>

      <div className="pw-dock-wrap">
        <div className="pw-dock">
          <div
            className="pw-seg"
            role="tablist"
            aria-label="会话筛选"
            data-index={filter === "all" ? 0 : filter === "active" ? 1 : 2}
          >
            <span className="pw-seg-ind" aria-hidden="true" />
            <button
              type="button"
              role="tab"
              aria-selected={filter === "all"}
              className={filter === "all" ? "is-active" : ""}
              onClick={() => setFilter("all")}
            >
              全部
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === "active"}
              className={filter === "active" ? "is-active" : ""}
              onClick={() => setFilter("active")}
            >
              进行中 <span>1</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === "waiting"}
              className={filter === "waiting" ? "is-active" : ""}
              onClick={() => setFilter("waiting")}
            >
              等待中 <span>1</span>
            </button>
          </div>
          <Link href="/preview/pwa" className="pw-newbtn" title="新建会话" onClick={onPick}>
            <IconPlus size={18} />
          </Link>
        </div>
      </div>
    </>
  );
}
