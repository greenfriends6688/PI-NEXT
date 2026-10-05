// D-23 设备视口 · 帧 A —— 比「机型预设行」这块数据无关的 chrome（板面 .d-tinybar）。
export default {
  name: "D-23 设备视口 · 帧 A 机型行",
  board: "v5/web/boards/D-23-browser-viewport.html",
  boardRoot: ".d-scene:nth-of-type(1) .d-tinybar",
  app: {
    script: `
      const b = [...document.querySelectorAll("button.d-iconbtn")].find(x => /globe/i.test(x.innerHTML));
      if (b) { b.click(); await new Promise(r => setTimeout(r, 1800)); }
      const p = document.querySelector(".d-device-preset");
      if (p) { p.click(); await new Promise(r => setTimeout(r, 900)); }
    `,
  },
  ignore: ["d-grow"],
  appRoot: ".d-tinybar",
  maxRows: 30,
};
