"use client";

import { useI18n } from "@/hooks/useI18n";
import { getFileName } from "@/lib/file-paths";
import type { WrittenFile } from "@/lib/turn-written-files";
import { getFileIcon } from "./FileIcons";

/**
 * Lists the files a turn actually wrote, as buttons that open each one in the
 * preview pane. Entries come from the turn's successful `write`/`edit` tool
 * calls — the reply text is never scanned for paths.
 *
 * fork:design-system —— 画板 53 帧 B：pencil-line 小标题一行 + `.pw-wrap` 里
 * 一枚枚 `.pw-chip`（文件图标 + 文件名）。画板里的「+2 −0」增删计数产品数据
 * 模型没有（WrittenFile 只有路径），按结构照实现不上。
 */
export function TurnWrittenFiles({ files, onOpenFile }: {
  files: WrittenFile[];
  onOpenFile?: (filePath: string) => void;
}) {
  const { t } = useI18n();
  if (files.length === 0) return null;

  return (
    <div className="pw-wrap" aria-label={t("chat.filesWritten")} style={{ marginTop: "var(--s2)" }}>
      {files.map(({ filePath }) => {
        const name = getFileName(filePath);
        return (
          <button
            key={filePath}
            type="button"
            className="pw-chip"
            title={filePath}
            aria-label={t("chat.openWrittenFile", { name })}
            onClick={() => onOpenFile?.(filePath)}
          >
            <span className="pw-ico">{getFileIcon(name, 12)}</span>
            <span>{name}</span>
          </button>
        );
      })}
    </div>
  );
}
