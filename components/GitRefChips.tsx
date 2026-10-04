"use client";

import type { CSSProperties, ReactNode } from "react";
import type { GitRefTag, GitRefTagKind } from "@/lib/git-graph-refs";

// Ref decoration chips share the lane color of the commit they decorate, so a
// tag visually reads as sitting on its branch line. HEAD is solid; the other
// kinds are tinted fills of the same lane color. Shared by the git-graph
// tab and the @comment: menu's commit rows.
//
// fork:design-components —— 形状 / 字号 / 圆角 / 等宽全部由 board.css 的
// `.pw-badge count` 给（画板 31：`<span class="pw-badge count"><span class="pw-ico">
// <i data-ico="git-branch"></i></span>main</span>`）。这里只剩设计系统不管的两件事：
// 泳道色，和「这条 ref 是哪一类」的那枚画板图标。
//
// fork:v5-wave-b —— **这一对 `pw-*` 保留**：`components/GitRefChips.ui.test.mjs`
// 把「两枚芯片都挂 pw-badge + count」当源码守卫断言（逐字符串匹配），改掉它等于删测试；
// 泳道图（画板 31）在 PWA 侧**没有对应画板**（M-01~M-12 里没有 git 泳道），
// 所以这里不给窄屏加 m-* 分支 —— 没有可抄的画板就不抄（缺件已登记）。
// 窄屏上泳道整块由右栏/查看器的宿主决定去留，本组件不参与。
const REF_ICON: Record<GitRefTagKind, "git-branch" | "tag"> = {
  head: "git-branch",
  branch: "git-branch",
  remote: "git-branch",
  tag: "tag",
};

function refChipStyle(kind: GitRefTagKind, laneColor: string): CSSProperties {
  if (kind === "head") {
    return { background: laneColor, color: "var(--bg)" };
  }
  return {
    color: laneColor,
    background: `color-mix(in srgb, ${laneColor} 10%, transparent)`,
  };
}

function RefChip({ tag, laneColor }: { tag: GitRefTag; laneColor: string }) {
  return (
    <span
      className="pw-badge count"
      title={tag.ref}
      style={{ maxWidth: 180, overflow: "hidden", ...refChipStyle(tag.kind, laneColor) }}
    >
      <span className="pw-ico"><i data-ico={REF_ICON[tag.kind]} data-size="11"></i></span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{tag.label}</span>
    </span>
  );
}

// "HEAD -> main" parses as two adjacent tags (solid HEAD + tinted branch);
// they render fused into one pill so the decoration reads as a single tag.
// Each segment keeps its original treatment and the shared lane color.
function FusedRefChip({ head, branch, laneColor }: { head: GitRefTag; branch: GitRefTag; laneColor: string }) {
  return (
    <span className="pw-badge count" title={branch.ref} style={{ maxWidth: 180, padding: 0, overflow: "hidden" }}>
      <span
        className="pw-badge"
        style={{ borderRadius: "var(--radius-3) 0 0 var(--radius-3)", background: laneColor, color: "var(--bg)" }}
      >
        <span className="pw-ico"><i data-ico={REF_ICON.head} data-size="11"></i></span>
        {head.label}
      </span>
      <span
        className="pw-badge"
        style={{ borderRadius: `0 var(--radius-3) var(--radius-3) 0`, color: laneColor, background: `color-mix(in srgb, ${laneColor} 10%, transparent)` }}
      >
        <span className="pw-ico"><i data-ico={REF_ICON.branch} data-size="11"></i></span>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{branch.label}</span>
      </span>
    </span>
  );
}

export function RefTagList({ tags, laneColor }: { tags: GitRefTag[]; laneColor: string }) {
  const items: ReactNode[] = [];
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index];
    const next = tags[index + 1];
    const key = `${tag.kind}:${tag.ref}:${index}`;
    if (tag.kind === "head" && next?.kind === "branch" && next.ref.startsWith("HEAD -> ")) {
      items.push(<FusedRefChip key={key} head={tag} branch={next} laneColor={laneColor} />);
      index += 1;
    } else {
      items.push(<RefChip key={key} tag={tag} laneColor={laneColor} />);
    }
  }
  return <>{items}</>;
}
