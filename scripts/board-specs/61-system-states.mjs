// 画板 61 系统状态页 —— 帧 1「拖放落区」
//
// 这一帧里产品**真实存在**的那一件是「拖文件进窗口 → 转录区亮起可接受落区」：
// ChatWindow 的 `.chat-content` 上挂着 useDragDrop（hooks/useDragDrop.ts），
// 可接受态渲染 `.pw-drop`（= 画板 A 段），拒绝态渲染 `.pw-drop.reject`（= 画板 B 段）。
//
// 怎么开进这个状态：先打开一条有消息的会话（转录区才挂得上落区），再在页面里合成一次
// 「拖着文件进窗口」的 dragenter/dragover。hook 只看 `dataTransfer.items` 里有没有
// `kind === "file"` 的项，而 Chrome 里 `new DataTransfer()` + `items.add(new File(...))`
// 造得出这种项 —— 所以落区是**产品自己**置上的 `isDragOver`，不是脚本改的 DOM。
//
// 这一帧没纳入本 spec 的（原因见文件末，数字都量过）：
//   · B 段 `.pw-drop.reject`：拒绝态要求 items 里**没有** file 项。合成的 DataTransfer
//     造不出这种列表（DataTransferItemList.add 只收 File，setData 产生的字符串项在
//     合成事件里读不到），必须真人拖一段页面文字进窗口。
//   · C 段「拖到输入框」：输入框没有这态（见文件末）。
//   · D 段「拖放规则四条」：是画板的说明件，不是界面。
//
// knownDiffs 里这一条目前不触发（board-diff 只在两边**文本相同**时才比 w/h，
// 两边文案不同，宽高被自动跳过）；它是给数字兜底的：哪天文案对上了、615px 的高度差
// 被摆到台面上，理由就在 spec 里写着。
export default {
  name: "系统态：拖放落区 · 可接受（画板 61 · 帧 1）",
  board: "61-system-states.html",
  boardFrame: 1,
  app: {
    script: `
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const byIco = (root, name) => [...root.querySelectorAll('[data-ico="' + name + '"]')][0];

      // 项目组默认收起，先展开再点第一条会话（有消息的会话才有转录区）。
      if (!document.querySelector(".pw-session")) {
        const toggle = byIco(document.querySelector(".pw-side-scroll") ?? document, "chevron-right")
          ?.closest("[role=button]");
        if (toggle) { toggle.click(); await wait(800); }
      }
      const row = document.querySelector(".pw-session");
      if (!row) throw new Error("侧栏里没有 .pw-session（会话没被列出来？）");
      row.click();
      await wait(2500);

      const target = document.querySelector(".chat-content");
      if (!target) throw new Error("转录区没有挂上（.chat-content 缺失）");

      // 合成一次「拖着文件进窗口」：dragenter 命中 file 项 → isDragOver → 渲染 .pw-drop。
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(8)], "screenshot-4k.png", { type: "image/png" }));
      for (const type of ["dragenter", "dragover"]) {
        target.dispatchEvent(new DragEvent(type, {
          bubbles: true, cancelable: true, dataTransfer: dt,
        }));
      }
      await wait(900);
      if (!document.querySelector(".pw-drop")) throw new Error("拖放落区没有出现（isDragOver 没置上）");
    `,
    settle: 800,
  },
  pairs: [
    // A 段：可接受落区（纸夹 mark + 主文案 + 涟漪）
    [".pw-drop", ".pw-drop"],
    [".pw-drop .mark", ".pw-drop .mark"],
    [".pw-drop .pw-ico", ".pw-drop .pw-ico"],
    // C 段：落点更精确那一态的输入框三段（工具条 / 纸夹钮 / 发送钮在这个状态下同时在场）
    [".pw-composer-bar", ".pw-composer-bar"],
    [".pw-iconbtn", ".pw-composer-bar .pw-iconbtn"],
    [".pw-send", ".pw-send"],
  ],
  knownDiffs: [
    {
      sel: ".pw-drop",
      reason: "**取景差异**：画板 A 段画的是 280px 高的**示意框**（框内还有一行「转录区」标签），"
        + "落区本身 688×229.5；产品的落区是 `.chat-content > .pw-drop` 上的 `absolute inset-3`，"
        + "按真实转录区铺开，量到 1140.5×844.5（宽窄差是同一件事的两面）。"
        + "落区自身的每一项都逐字相同：圆角 6px / 内边距 24px / gap 8px / display grid / "
        + "align-items center / 字号 13px / 行高 19.5px；里面的 `.mark`（40×40）与纸夹图标"
        + "（20×20）也完全一致。",
    },
  ],
  tolerance: { box: 2, fontSize: 0 },
};