/* D-04 帧 A —— 输入卡工具条（能力芯片一行）。
 * 板：section 第 1 帧的 .d-composer-bar（静息态那一行）
 * 产品：.chat-input-toolbar.d-composer-bar（桌面 ≥1025，narrowControls=false 分支）
 */
import { waitFor } from "./_d04.mjs";

export default {
  name: "D-04 帧 A · 工具条能力芯片",
  board: "v5/web/boards/D-04-composer.html",
  frame: 0,
  boardRoot: "section.d-scene:nth-of-type(1) .d-composer-bar",
  app: { script: `${waitFor(".chat-input-toolbar.d-composer-bar")}` },
  appRoot: ".chat-input-toolbar.d-composer-bar",
  ignore: ["d-grow", "m-grow"],
  maxRows: 60,
};
