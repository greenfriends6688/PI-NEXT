/**
 * fork:upstream-0.12-chat-parity —— 把扩展通知切成散文与「用方块字符画的」行（#755）。
 *
 * 终端二维码 / 进度条（`qrcode-terminal` 经 `ctx.ui.notify()` 发出来）只在终端网格上
 * 对得齐：每个空格都要留、空格与方块用同一份等宽字体、行与行之间不能有间距。toast 的
 * 散文样式会折叠连续空格、把行距拉开。把各部分的文本接回去等于原消息；run 前后的换行
 * 留在散文里。
 */

export interface NoticeTextPart {
  kind: "text" | "art";
  text: string;
}

// Block elements (█ ▀ ▄ ▌ ░ …): what terminal QR codes and bars are drawn with.
const BLOCK_ELEMENT_RE = /[▀-▟]/;

export function splitNoticeText(message: string): NoticeTextPart[] {
  const parts: NoticeTextPart[] = [];
  const push = (kind: NoticeTextPart["kind"], text: string) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };

  let previousIsArt = false;
  message.split("\n").forEach((line, index) => {
    const isArt = BLOCK_ELEMENT_RE.test(line);
    if (index > 0) push(isArt && previousIsArt ? "art" : "text", "\n");
    push(isArt ? "art" : "text", line);
    previousIsArt = isArt;
  });
  return parts;
}
