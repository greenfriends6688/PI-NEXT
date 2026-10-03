import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  // 产物 / 一次性脚本目录（gitignored）；里面的补丁基线是源文件副本，只会产生重复告警
  { ignores: ["test-results/**", ".scratch/**"] },
  {
    // Reference checkouts and build output are not part of this project's source.
    // 设计风格/ 与 .playwright-mcp/ 是本地素材与浏览器抓取产物（.gitignore 已忽略），
    // 不属于本项目源码；漏掉它们会让 `npm run lint` 在别人的素材上炸出一堆 TS 规则报错。
    ignores: ["release/**", "参考项目/**", "pi参考项目/**", "家里电脑跑的/**", "设计风格/**", ".playwright-mcp/**",
      // docs/**/evidence/ 放的是**上游仓库原样拷贝**的产物（上游自己的
      // zcode-*.js 打包文件），不是本项目源码：它们是 minified 的第三方代码，
      // 过 TS/React 规则必然报解析错。归档证据不该被 lint。
      "docs/**/evidence/**"],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    // Last: the Electron main process is CommonJS by construction, and the
    // shared configs above re-enable the rule.
    // bin/ 同样是「按构造就是 CommonJS」：这些是 npm bin 启动器与 LAN 监督器，
    // 必须在还没构建出任何东西的机器上被 node 直接跑起来（fork:lan-access 给
    // readLanAccessState 加了同步 require("fs"/"path"/"os")，为此把整个 bin/ 排除）。
    files: ["electron/**/*.js", "bin/**/*.js", "bin/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
];

export default eslintConfig;
