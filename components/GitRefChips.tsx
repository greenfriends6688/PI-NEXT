"use client";

import type { CSSProperties } from "react";
import type { GitRefTag, GitRefTagKind } from "@/lib/git-graph-refs";

// Ref decoration chips share the lane color of the commit they decorate, so a
// tag visually reads as sitting on its branch line. HEAD is solid; the other
// kinds are tinted fills of the same lane color. Shared by the git-graph
// tab and the @comment: menu's commit rows.
//
// fork:v5-landing D-03e 帧 C —— 芯片从 v1 的 `.pw-badge.count` 换成画板的
// `.d-chips` + `.d-cite`（HEAD 用 `.d-cite.is-on`）。三枚引用芯片与「改了哪些
// 文件」那一行 chips 是同一个原语；此前这里另起一套 `pw-badge` + `pw-ico`
// 包装层，同一行里两套芯片。图标词表（git-branch / tag）不变。
//
// 泳道色仍然由组件给：`d-cite` 的形状/字号/圆角全在 system.css，色相要跟它
// 所在的那条泳道走，而泳道色是**数据**（不是令牌表里的值）。
//
// fork:v5-wave-b —— PWA 侧**没有** git 泳道画板（M-01~M-12 里没有），所以这里
// 不给窄屏加 m-* 分支：没有可抄的画板就不抄（缺件已登记）。
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
      className={tag.kind === "head" ? "d-cite is-on" : "d-cite"}
      title={tag.ref}
      style={{ maxWidth: 180, overflow: "hidden", ...refChipStyle(tag.kind, laneColor) }}
    >
      <i data-ico={REF_ICON[tag.kind]} data-size="11"></i>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{tag.label}</span>
    </span>
  );
}

// "HEAD -> main" parses as two adjacent tags (solid HEAD + tinted branch).
// The board draws them as **one** chip reading `HEAD → main` — one ref on one
// lane, not two pills that happen to touch. So the fusion keeps the parsing and
// drops the two-segment rendering.
function FusedRefChip({ head, branch, laneColor }: { head: GitRefTag; branch: GitRefTag; laneColor: string }) {
  return (
    <span
      className="d-cite is-on"
      title={branch.ref}
      style={{ maxWidth: 180, overflow: "hidden", ...refChipStyle("head", laneColor) }}
    >
      <i data-ico={REF_ICON.head} data-size="11"></i>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{`HEAD → ${branch.label}`}</span>
    </span>
  );
}

export function RefTagList({ tags, laneColor }: { tags: GitRefTag[]; laneColor: string }) {
  const items: React.ReactNode[] = [];
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
  return <span className="d-chips">{items}</span>;
}