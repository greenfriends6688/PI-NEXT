// 画板 50 弹窗合集 —— 帧 0「项目信任 · 目录选择器」
//
// 这一帧里产品**真实存在**的两个状态，本 spec 一次把它们量完：
//   A 段 = ProjectTrustDialog（components/ProjectTrustDialog.tsx，桌面端点信任提示条打开）
//   D 段 = DirectoryPicker 自绘浏览器（components/DirectoryPicker.tsx，画板写明的回退态）
//
// 怎么把产品开进这两个状态（全部走产品自己的入口，没改任何产品代码/环境变量）：
//   1. 画板 50 的决策链第 4 步写明「`/api/cwd/pick` 返回 501 或失败 → 退到自绘浏览器」。
//      本机跑没有可用的系统选框，接口会挂到 65s 超时，规格里直接把这一次 fetch 短路成
//      501 —— 这是画板自己规定的那条回退路径，不是伪造状态。
//   2. 用自绘选择器把工作目录切到一个**未信任**的夹具目录（目录里有 `.pi/extensions`，
//      `hasTrustRequiringProjectResources` 才会判 requiresTrust），桌面端随即出现
//      `button.pw-alert` 信任提示条；点它开对话框。
//   3. board-diff 一份 spec 只跑一个 app 状态，而这一帧要量两段，所以脚本最后**再开一次**
//      目录选择器：`.pw-modal/-head/-body/-foot` 取文档里第一个（= 信任框，选择器走
//      createPortal 挂在 body 末尾，排在后面），`.pw-list` / `.pw-litem` / `.pw-lname`
//      只存在于选择器里，于是各自落到该落的那一段。
//
// 前置夹具（不在仓库里，跑之前确认它还在、且**没有被信任过**）：
//   mkdir -p ~/pi-web-chat/board50-trust/.pi/extensions
//   echo 'export default function () {}' > ~/pi-web-chat/board50-trust/.pi/extensions/demo-ext.js
//   rm -f "$PI_CODING_AGENT_DIR/trust.json"   # 里面有这条目录就会直接跳过对话框
// 注意：脚本里**绝不点「信任项目」**——那会往 agent 目录写 trust.json，把夹具变成已信任。
//
// 未纳入本 spec 的（原因写在报告里，不是漏测）：
//   · B 段「信任中 / 写入失败」：产品同一组件的 busy/error 态，错误文案要一次真实的
//     写入失败才出现（脚本点「信任项目」才会产生，而那会写 trust.json）。
//   · C 段决策链表 / C2「已选定」条：是画板自己的说明件，产品没有对应界面。
//   · A 段的「记住这个选择」`.pw-switch`、D 段的 `.pw-input`、`.pw-litem.is-on`、
//     行内「重命名 / 删除」按钮：产品在这个状态下没有这些节点（真的缺，见报告）。
//
// 几处「工具量不到、但确实存在」的差（board-diff 只在两边**文本相同**时才比 w/h，
// 这几个节点两边文案不同，工具自动跳过；数字记在这里备查）：
//   · `.pw-modal`     画板 714×226  ↔ 产品 440×180（少一整行 `.pw-field` + `.pw-switch`）
//   · `.pw-modal-body`画板 712×126.5 ↔ 产品 438×84.5（差 42px = 34px 的开关行 + 8px gap）
//   · `.pw-list`      画板 680×202  ↔ 产品 486×456（画板是内容定高的 6 行样张，
//                     产品把面板钉在 min(620px, 100dvh−16px) 且列表 flex:1）
export default {
  name: "弹窗：项目信任对话框 + 自绘目录选择器（画板 50 · 帧 0）",
  board: "50-dialogs.html",
  boardFrame: 0,
  app: {
    script: `
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const FIXTURE = "/Users/yingjing/pi-web-chat/board50-trust";

      // 画板 50 决策链第 4 步：/api/cwd/pick 不可用 → 退到自绘目录选择器。
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : (input && input.url) || "";
        if (url.includes("/api/cwd/pick")) {
          return new Response(JSON.stringify({ error: "unavailable" }), {
            status: 501, headers: { "Content-Type": "application/json" },
          });
        }
        return nativeFetch(input, init);
      };

      const openFolderPicker = async () => {
        const chip = document.querySelector(".pw-ctxbar .pw-chip");
        if (!chip) throw new Error("找不到输入框上方的项目芯片（.pw-ctxbar .pw-chip）");
        chip.click();
        await wait(700);
        const item = [...document.querySelectorAll("[role=menuitem]")]
          .find((el) => /打开文件夹/.test(el.textContent || ""));
        if (!item) throw new Error("项目芯片菜单里没有「打开文件夹」");
        item.click();
        await wait(1800);
        if (!document.querySelector(".directory-picker-panel")) {
          throw new Error("自绘目录选择器没有打开（/api/cwd/pick 的 501 回退没生效？）");
        }
      };

      // 1) 打开自绘选择器，把 cwd 切到未信任的夹具目录。
      await openFolderPicker();
      const path = document.querySelector("#directory-path");
      if (!path || !path.form) throw new Error("目录选择器里没有路径输入框");
      const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setValue.call(path, FIXTURE);
      path.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(150);
      path.form.requestSubmit();
      await wait(1600);
      const use = [...document.querySelectorAll(".directory-picker-footer button")]
        .find((b) => !/取消/.test(b.textContent || ""));
      if (!use) throw new Error("目录选择器底部没有「选择此文件夹」");
      use.click();
      await wait(3500);

      // 2) 桌面端的项目信任提示条 → 点开画板 50 A 段的 pw-modal。
      const banner = document.querySelector("button.pw-alert");
      if (!banner) {
        throw new Error("没有出现项目信任提示条：当前目录要么已被信任，要么没有 .pi/extensions 这类需信任资源");
      }
      banner.click();
      await wait(1200);
      if (!document.querySelector('[data-fork-dialog="trust"] .pw-modal')) {
        throw new Error("项目信任对话框没有打开");
      }

      // 3) 再开一次选择器，让同一帧里的 D 段原子也进入这一轮测量。
      await openFolderPicker();
    `,
    settle: 2000,
  },
  pairs: [
    // A 段：项目信任对话框（画板 col A ↔ [data-fork-dialog=trust] 里的 pw-modal）
    [".pw-modal", ".pw-modal"],
    [".pw-modal-head", ".pw-modal-head"],
    [".pw-modal-body", ".pw-modal-body"],
    [".pw-modal-foot", ".pw-modal-foot"],
    [".pw-modal-body p", ".pw-modal-body p"],
    [".pw-modal-body .pw-inline", ".pw-modal-body .pw-inline"],
    [".pw-modal-body .pw-mono", ".pw-modal-body .pw-mono"],
    [".pw-modal-foot .pw-btn", ".pw-modal-foot .pw-btn"],
    [".pw-modal-foot .pw-btn.primary", ".pw-modal-foot .pw-btn.primary"],
    // C2 的「已选定」徽章 —— 同一个 .pw-badge 原子在产品里落在侧栏底栏那枚版本徽章上
    [".pw-badge", ".pw-badge"],
    // D 段：自绘目录选择器（画板 col D ↔ .directory-picker-panel）
    [".pw-list", ".pw-list"],
    [".pw-litem", ".pw-litem"],
    [".pw-lname", ".pw-lname"],
    [".pw-iconbtn", ".directory-picker-panel .pw-iconbtn"],
    // .pw-btn.sm 原子：画板这一帧的第一枚是 B 段失败态的「重试」，产品侧落在信任框的
    // 「取消」上 —— 用来证明 sm 档本身逐项相同（对话框只是挑错了档位，见下面两项 FAIL）。
    // fork:board-diff-2026-10-01 —— 收窄到 .pw-modal-body 里的 sm 钮（双方都是普通 ghost 档）。
    // 裸 `.pw-btn.sm` 会取到「第一枚」：画板侧是 ghost（400）、产品侧可能落在 primary（500），
    // 量到的是两个不同角色的按钮（字体差不是漂移）。
    [".pw-modal-body .pw-btn.sm", ".pw-modal-body .pw-btn.sm"],
  ],
  // knownDiffs 里这一条目前不触发（board-diff 只在两边**文本相同**时才比 w/h，
// 两边文案不同，工具自动跳过了宽高）。它是给数字兜底的：哪天文案对上了、高度差被摆到
// 台面上，理由就在 spec 里写着。真漂移（少一行开关、按钮档位）不登记在这里，见文件头。
knownDiffs: [
  {
    sel: ".pw-list",
    reason: "**取景差异**：画板 D 段是内容定高的样张（6 行目录 = 202px 高），"
      + "产品的自绘选择器把面板钉在 min(620px, calc(100dvh − 16px))（DirectoryPicker.tsx:228），"
      + "列表又是 flex:1 的滚动容器，于是列表量到 456px。列表本身的每一项都对得上："
      + "圆角 0 / 字号 12px / 行高 18px / gap 2px / display grid；32px 高的 `.pw-litem` 也逐项一致。",
  },
],
  tolerance: { box: 2, fontSize: 0 },
};