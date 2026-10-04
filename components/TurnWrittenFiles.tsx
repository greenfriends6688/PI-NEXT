"use client";

import { useI18n } from "@/hooks/useI18n";
import { getFileName } from "@/lib/file-paths";
import type { WrittenFile } from "@/lib/turn-written-files";
import { getFileIcon } from "./FileIcons";
// fork:v5-wave-b —— PWA 形态：chips 行换成画板 M-03/M-08/M-10 的 `.m-tray` +
// `.m-tray-chip`（PWA 库里唯一的芯片原语；`m-chips` / `m-chipbtn` 定义了但没有
// 画板在用，不新造也不拿死类当视觉来源 —— 登记在汇报里）。
import { usePwaSkin } from "@/components/pwa/skin";

/**
 * Lists the files a turn actually wrote, as buttons that open each one in the
 * preview pane. Entries come from the turn's successful `write`/`edit` tool
 * calls — the reply text is never scanned for paths.
 *
 * fork:v5-landing —— 画板 D-03e 帧 B：`.d-chips` 里一枚枚 `.d-cite`
 * （文件图标 + 文件名）。画板里的「新增」徽章与「+2 −0」增删计数产品数据
 * 模型没有（WrittenFile 只有路径），按结构照实现不上。
 */
export function TurnWrittenFiles({ files, onOpenFile }: {
  files: WrittenFile[];
  onOpenFile?: (filePath: string) => void;
}) {
  const { t } = useI18n();
  const isPwa = usePwaSkin();
  if (files.length === 0) return null;

  return (
    <div className={isPwa ? "m-tray" : "d-chips"} aria-label={t("chat.filesWritten")}>
      {files.map(({ filePath }) => {
        const name = getFileName(filePath);
        return (
          <button
            key={filePath}
            type="button"
            className={isPwa ? "m-tray-chip" : "d-cite"}
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
