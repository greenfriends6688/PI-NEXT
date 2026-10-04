// after-pack.mjs — electron-builder afterPack 钩子（签名之前跑，三件事）
//
// 1) 注入 .next/node_modules/<pkg>-<hash> → 产物 app/node_modules/<pkg> 的**相对符号链接**。
//    Turbopack 把 serverExternalPackages（undici、pi SDK、node-pty 等）外部化为
//    .next/node_modules/<pkg>-<hash> 符号链接（指向项目 node_modules），编译产物里的
//    chunk 按这个哈希包名 require；electron-builder 既不带符号链接打包，files 排除规则
//    （node_modules/** 前缀）也罩不到 .next 下面。上一版在这里把解引用后的副本 cpSync
//    进包——一份 pi-coding-agent 副本就是 400M+（0.1.8 DMG 380M 的最大单一原因）。
//    现在改成：真包在产物里就链接过去（哈希副本与顶层包逐字等价，只多 .bin 垫片，
//    已用文件清单 diff 验证）；真包不在才退回复制。webpack 构建没有 .next/node_modules
//    （chunk 按顶层包名 require），直接跳过。
//    源码树里现存的解引用副本（打包技能 Step 3 的产物）也走同一条映射，不受影响。
//
// 2) 裁掉非目标平台的 esbuild 二进制。pi-coding-agent 内嵌全套 @esbuild/*（26 个平台
//    ~250M），运行时只加载本平台一块；build.files 只排除了顶层 @esbuild，嵌套的漏网。
//    目标平台按 appOutDir 目录名后缀判定（context.arch 是内部枚举，版本间数值不稳），
//    认不出就不裁（fail open）。build.files 与平台无关（同一份清单要打 win 包），
//    所以这步只能在这里做。
//
// 3) 删 .next 下所有 *.nft.json。那是 Next 的文件追踪清单（standalone 拷贝阶段用），
//    运行时不读；路由一多每份 5M+，0.1.8 里它们占 280M。
//
// 产物布局依平台不同（asar:false 时整个项目被平铺到 resources/app）：
//   - darwin          <appOutDir>/<Product>.app/Contents/Resources/app
//   - win32 / linux   <appOutDir>/resources/app
// 早期版本只处理了 macOS 的 Contents/Resources 路径，Windows 上会把文件拷到一个
// 不被使用的 <Product>.exe/... 目录（cpSync 会自建目录，所以不报错），产物里则
// 永远缺这一层——表现为打包后 /api/terminal、SSE、会话接口半残。
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";

// Turbopack 哈希后缀：16 位十六进制内容哈希（pi-coding-agent-4cdde81112ef3dc5）。
// 只有「目标真包存在且带 package.json」才敢剥；剥不中保持原名原样。
const HASH_DIR = /^(.+)-([0-9a-f]{16})$/;

const APP_NM = "node_modules";

/** 在产物 app/ 下从 <pkg>-<hash> 映射出目标真包路径；找不到返回 null。 */
function resolveRealPackage(appDir, scopeParts, entryName) {
  const m = HASH_DIR.exec(entryName);
  const pkgName = m ? m[1] : entryName;
  const parts = [...scopeParts, pkgName];
  const target = join(appDir, APP_NM, ...parts);
  if (!existsSync(join(target, "package.json"))) return null;
  return target;
}

/**
 * 把源码树 .next/node_modules 注入产物：优先符号链接（真包在产物里），
 * 退回复制（真包没被 files 收进去时保可用性）。
 * ⚠️ Windows 整体走复制：NTFS 符号链接要管理员/开发者模式，junction 只收
 * 绝对路径——NSIS 装到新目录后绝对链接必断。相对符号链接只在 darwin/linux 用。
 */
function injectNextNodeModules(projectDir, appDir, platform) {
  const srcRoot = join(projectDir, ".next", "node_modules");
  const destRoot = join(appDir, ".next", "node_modules");
  if (!existsSync(srcRoot)) {
    console.log("[after-pack] 无 .next/node_modules（webpack 构建或为空），跳过注入");
    return;
  }
  rmSync(destRoot, { recursive: true, force: true });

  const useLinks = platform !== "win32";
  // 源符号链接若仍指向项目 node_modules，按 realpath 精确映射（保真版本选择）；
  // 解引用副本没有这个信息，退回哈希剥名（已验证与顶层包逐字等价）。
  let projectNm = null;
  try { projectNm = realpathSync(join(projectDir, APP_NM)); } catch { /* 没有就不做精确映射 */ }

  let linked = 0, copied = 0;
  const copiedNames = [];

  const visit = (srcDir, destDir, scopeParts) => {
    mkdirSync(destDir, { recursive: true });
    for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
      const sp = join(srcDir, entry.name);
      const dp = join(destDir, entry.name);
      if (entry.name.startsWith("@") && entry.isDirectory()) {
        visit(sp, dp, [...scopeParts, entry.name.slice(1)]);
        continue;
      }
      if (!entry.isDirectory()) continue; // 散文件（.package-lock.json 之类）不注入

      let target = null;
      if (useLinks) {
        if (entry.isSymbolicLink()) {
          try {
            const real = realpathSync(sp);
            const rel = projectNm ? relative(projectNm, real) : "";
            if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
              const mapped = join(appDir, APP_NM, rel);
              if (existsSync(join(mapped, "package.json"))) target = mapped;
            }
          } catch { /* 断链就走剥名兜底 */ }
        }
        if (!target) target = resolveRealPackage(appDir, scopeParts, entry.name);
      }

      if (target) {
        mkdirSync(dirname(dp), { recursive: true });
        symlinkSync(relative(dirname(dp), target), dp);
        linked++;
      } else {
        cpSync(sp, dp, { recursive: true });
        copied++;
        copiedNames.push([...scopeParts, entry.name].join("/"));
      }
    }
  };
  visit(srcRoot, destRoot, []);
  if (useLinks) {
    console.log(`[after-pack] .next/node_modules 注入完成：${linked} 个符号链接` +
      (copied ? `，${copied} 个真包缺失退回复制（${copiedNames.join(", ")}）` : ""));
  } else {
    console.log(`[after-pack] .next/node_modules 注入完成：Windows 用复制（NTFS 符号链接不可移植），共 ${linked + copied} 项`);
  }
}

/** esbuild 保留平台：按 appOutDir 目录名后缀判定；认不出返回 null（不裁）。 */
function esbuildKeepPlatforms(appOutDir, electronPlatformName) {
  const outName = basename(appOutDir);
  if (electronPlatformName === "darwin") {
    if (outName.includes("universal")) return ["darwin-arm64", "darwin-x64"];
    if (outName.includes("arm64")) return ["darwin-arm64"];
    if (outName.includes("x64")) return ["darwin-x64"];
    return null;
  }
  if (electronPlatformName === "win32") return outName.includes("ia32") ? ["win32-ia32"] : ["win32-x64"];
  if (electronPlatformName === "linux") return outName.includes("arm64") ? ["linux-arm64"] : ["linux-x64"];
  return null;
}

/** 裁掉产物 node_modules 里所有不在保留名单上的 @esbuild/<platform>。 */
function pruneForeignEsbuild(appDir, keep) {
  if (!keep) {
    console.log("[after-pack] @esbuild 平台裁剪：无法判定目标平台，跳过");
    return 0;
  }
  let removed = 0;
  const visit = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const p = join(dir, entry.name);
      if (entry.name === "@esbuild") {
        for (const plat of readdirSync(p, { withFileTypes: true })) {
          if (plat.isDirectory() && !keep.includes(plat.name)) {
            rmSync(join(p, plat.name), { recursive: true, force: true });
            removed++;
          }
        }
        continue;
      }
      visit(p); // withFileTypes 是 lstat 语义，符号链接不会被误入
    }
  };
  visit(join(appDir, APP_NM));
  console.log(`[after-pack] @esbuild 裁剪：保留 ${keep.join(" / ")}，移除 ${removed} 个平台目录`);
  return removed;
}

/** 删 .next 下所有 *.nft.json（运行时不读的文件追踪清单）。 */
function deleteNftJson(appDir) {
  const nextDir = join(appDir, ".next");
  if (!existsSync(nextDir)) return 0;
  let n = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".nft.json")) { rmSync(p, { force: true }); n++; }
    }
  };
  walk(nextDir);
  return n;
}

export default async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  // appOutDir 是包含 .app / .exe 的那个目录（如 release/mac-arm64、release/win-unpacked），
  // 不是 bundle 内部
  const projectDir = packager.info?.projectDir || process.cwd();
  const productName = packager.appInfo.productFilename;

  const appResources = electronPlatformName === "darwin"
    ? join(appOutDir, `${productName}.app`, "Contents", "Resources")
    : join(appOutDir, "resources");

  if (!existsSync(appResources)) {
    console.log(`[after-pack] 未找到 ${appResources}，跳过注入（打包配置可能变了）`);
    return;
  }
  const appDir = join(appResources, "app");

  injectNextNodeModules(projectDir, appDir, electronPlatformName);
  pruneForeignEsbuild(appDir, esbuildKeepPlatforms(appOutDir, electronPlatformName));
  const nft = deleteNftJson(appDir);
  if (nft) console.log(`[after-pack] 已删 ${nft} 个 *.nft.json`);
}
