"use client";

import type { ReactNode } from "react";
import { formatFrontmatterValue, getFrontmatterTitle } from "@/lib/frontmatter";
// fork:v5-wave-b —— PWA 形态：frontmatter 卡换成画板 M-03/M-06 的 `.m-doc-frame`
// （文件头 + 正文两段）。
import { usePwaSkin } from "@/components/pwa/skin";

interface FrontmatterCardProps {
  data: Record<string, unknown> | null;
}

const TAG_KEYS = ["tags", "categories", "keywords", "tag", "category"];

function isUrl(value: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(value);
}

function renderValue(value: unknown): ReactNode {
  const text = formatFrontmatterValue(value);
  if (!text) return null;
  if (typeof value === "string" && isUrl(value)) {
    // Only safe schemes — values come from the user's own file but stay escaped
    // by React regardless; this just prevents javascript: hrefs.
    return (
      <a href={value} target="_blank" rel="noopener noreferrer">
        {text}
      </a>
    );
  }
  // Arrays are rendered as inline text; anything else keeps its plain text form.
  return text;
}

export function FrontmatterCard({ data }: FrontmatterCardProps) {
  const isPwa = usePwaSkin();
  if (!data) return null;
  const entries = Object.entries(data);
  if (entries.length === 0) return null;

  const title = getFrontmatterTitle(data.title);

  const tagKey = TAG_KEYS.find((key) => Array.isArray(data[key]));
  const tags = tagKey
    ? (data[tagKey] as unknown[]).map(formatFrontmatterValue).filter(Boolean)
    : [];

  const rows = entries.filter(([key]) => key !== tagKey && (key !== "title" || !title));

  /* fork:v5-landing —— frontmatter 单独成卡 = 画板 D-06b 帧 B：
   * `.d-card` 壳 › `.d-card-head`（braces 图标 + `.d-grow.d-mono.d-t-sm` 小标题）
   * › `.d-card-body.d-col`：标题 `.d-t-b` / 标签 `.d-tags` + `.d-badge.mute` / 键值 `.d-kv-row`。
   * 标题行与标签行仍走原来的语义（给人看），键值表是原样回显。
   * fork:v5-wave-b —— 窄屏抄画板 M-06 帧 B 的那组 `.m-viewbox > .m-doc-head +
   * .m-doc-body`：壳 `.m-doc-frame`、头 `.m-doc-head`、体 `.m-doc-body`，
   * 标签行用 `.m-doc-tags`，键值行用 `.m-fieldrow`（PWA 库里唯一带下边线的行）。
   * 测试钩子（markdown-frontmatter / -rows / -row）两个形态都保留。 */
  return (
    <div className={`markdown-frontmatter ${isPwa ? "m-doc-frame" : "d-card"}`}>
      <div className={isPwa ? "m-doc-head" : "d-card-head"}>
        <i data-ico="braces" data-size="14"></i>
        <span className={isPwa ? "m-grow m-mono" : "d-grow d-mono d-t-sm"}>frontmatter</span>
      </div>
      <div className={isPwa ? "m-doc-body" : "d-card-body d-col"} style={{ gap: "var(--nx-sp-2)" }}>
        {title && <div className={isPwa ? "m-t-b" : "d-t-b"}>{title}</div>}
        {tags.length > 0 && (
          <div className={isPwa ? "m-doc-tags" : "d-tags"}>
            {tags.map((tag, index) => (
              <span className={isPwa ? "m-badge mute" : "d-badge mute"} key={`${tag}-${index}`}>
                {tag}
              </span>
            ))}
          </div>
        )}
        {rows.length > 0 && (
          <div className={`markdown-frontmatter-rows${isPwa ? "" : " d-col"}`}>
            {rows.map(([key, value]) => (
              <div className={`markdown-frontmatter-row ${isPwa ? "m-fieldrow" : "d-kv-row"}`} key={key}>
                <span>{key}</span>
                <span>{renderValue(value)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
