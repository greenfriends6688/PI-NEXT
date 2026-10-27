"use client";

import { useI18n } from "@/hooks/useI18n";
import { getFileName } from "@/lib/file-paths";
import type { WrittenFile } from "@/lib/turn-written-files";
import { getFileIcon } from "./FileIcons";

/**
 * The turn's written files, as plain chips. The board's `.filecard` pill (an
 * "edited N files" summary that unfolds) sat above these chips and repeated
 * them; the names are the useful part, so they are shown directly.
 */
export function TurnWrittenFiles({ files, onOpenFile }: {
  files: WrittenFile[];
  onOpenFile?: (filePath: string) => void;
}) {
  const { t } = useI18n();
  if (files.length === 0) return null;

  return (
    <div
      className="written-files"
      style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 6 }}
    >
      {files.map(({ filePath }) => {
        const name = getFileName(filePath);
        return (
          <button
            key={filePath}
            type="button"
            className="chip written-file-chip"
            title={filePath}
            aria-label={t("chat.openWrittenFile", { name })}
            onClick={() => onOpenFile?.(filePath)}
          >
            {getFileIcon(name, 12)}
            <span>{name}</span>
          </button>
        );
      })}
    </div>
  );
}
