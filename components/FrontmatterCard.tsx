"use client";

import type { ReactNode } from "react";
import { formatFrontmatterValue, getFrontmatterTitle } from "@/lib/frontmatter";

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
  if (!data) return null;
  const entries = Object.entries(data);
  if (entries.length === 0) return null;

  const title = getFrontmatterTitle(data.title);

  const tagKey = TAG_KEYS.find((key) => Array.isArray(data[key]));
  const tags = tagKey
    ? (data[tagKey] as unknown[]).map(formatFrontmatterValue).filter(Boolean)
    : [];

  const rows = entries.filter(([key]) => key !== tagKey && (key !== "title" || !title));

  /* fork:design-system —— frontmatter 单独成卡 = 画板 52 的 B 段：
   * pw-card 壳 › pw-card-head（braces 图标 + 「frontmatter」等宽小标题）› pw-kv 键值表。
   * 标题行与标签行仍走原来的类（产品已有语义），只在卡的骨架上换成画板类。 */
  return (
    <div className="markdown-frontmatter pw-card">
      <div className="pw-card-head">
        <span className="pw-ico pw-dim"><i data-ico="braces" data-size="13"></i></span>
        <span className="pw-mono pw-dim" style={{ fontSize: "var(--text-meta)" }}>frontmatter</span>
      </div>
      <div className="pw-card-body" style={{ padding: "var(--s2) var(--s3)" }}>
        {title && <div className="markdown-frontmatter-title">{title}</div>}
        {tags.length > 0 && (
          <div className="markdown-frontmatter-tags">
            {tags.map((tag, index) => (
              <span className="markdown-frontmatter-tag pw-badge" key={`${tag}-${index}`}>
                {tag}
              </span>
            ))}
          </div>
        )}
        {rows.length > 0 && (
          <dl className="markdown-frontmatter-rows pw-kv" style={{ gridTemplateColumns: "110px minmax(0, 1fr)" }}>
            {rows.map(([key, value]) => (
              <div className="markdown-frontmatter-row" key={key} style={{ display: "contents" }}>
                <dt>{key}</dt>
                <dd>{renderValue(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
