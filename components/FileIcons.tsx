/**
 * fork:design-components —— 文件图标**单色化**。
 *
 * 原来这里是一整套 catppuccin 彩色素材（`/icons/catppuccin/{latte,mocha}/*.svg`，
 * 靠 CSS mask 上色），与「视觉唯一来源是 board.css」冲突：图标是唯一还从外部
 * 图片素材取形的东西。现在改走画板 30 的**单色 lucide** 图标集——
 * 结构与 `30-files-panel.html` 的树行一字不差：
 *
 *     <span class="pw-ico"><i data-ico="file-code" data-size="14"></i></span>
 *
 * `components/PwIcons.tsx` 把 `<i data-ico>` 水合成 lucide 内联 SVG
 * （`design/pi-web-design/assets/icons.js` + `hydrate()`），本文件不写死任何
 * SVG 路径、不写死任何颜色 —— 颜色由 `.pw-trow .pw-ico`（--n-muted）给。
 *
 * 画板 30 树行只用三种字形（行 144-149）：`file-code`（代码）/ `braces`（数据与
 * 配置）/ `file-text`（文档）。下表把 catppuccin 的 30 个词表按**语义**并进这
 * 三种，再对确实需要区分的几类（图片 / 归档 / 数据库 / 音视频 / 锁文件）借用
 * 图标集里已有的对应字形。词表与登记见本轮交付报告。
 */

interface IconProps {
  size?: number;
}

/** 图标集（`design/pi-web-design/assets/icons.js`）里注册的字形名。 */
type LucideIconName =
  | "braces"
  | "box"
  | "database"
  | "file"
  | "file-archive"
  | "file-code"
  | "file-text"
  | "folder"
  | "folder-open"
  | "git-branch"
  | "image"
  | "lock"
  | "music"
  | "play"
  | "table";

/**
 * 画板唯一的图标壳：`.pw-ico` 负责 line-height 归零与图标文字的垂直居中，
 * `<i data-ico>` 由 PwIcons 水合。与画板写法一致，产品侧不写 SVG。
 */
function Icon({ name, size = 14 }: IconProps & { name: LucideIconName }) {
  return (
    <span className="pw-ico">
      <i data-ico={name} data-size={size} aria-hidden="true"></i>
    </span>
  );
}

export function FolderIcon({ size = 14, open = false }: IconProps & { open?: boolean }) {
  return <Icon name={open ? "folder-open" : "folder"} size={size} />;
}

export function GenericFileIcon({ size = 14 }: IconProps) {
  return <Icon name="file" size={size} />;
}

const EXTENSION_ICONS: Record<string, LucideIconName> = {
  // 代码（画板 30 的 file-code：tokens.css / board.css 都是它）
  ts: "file-code",
  tsx: "file-code",
  mts: "file-code",
  cts: "file-code",
  js: "file-code",
  jsx: "file-code",
  mjs: "file-code",
  cjs: "file-code",
  py: "file-code",
  rs: "file-code",
  go: "file-code",
  java: "file-code",
  kt: "file-code",
  swift: "file-code",
  c: "file-code",
  h: "file-code",
  hpp: "file-code",
  cpp: "file-code",
  php: "file-code",
  rb: "file-code",
  vue: "file-code",
  svelte: "file-code",
  html: "file-code",
  htm: "file-code",
  xml: "file-code",
  // 样式表按画板口径（tokens.css = file-code）并进代码一类
  css: "file-code",
  scss: "file-code",
  sass: "file-code",
  less: "file-code",
  styl: "file-code",
  // 数据与配置（画板 30 的 braces：icons.js）
  json: "braces",
  jsonl: "braces",
  jsonc: "braces",
  yaml: "braces",
  yml: "braces",
  toml: "braces",
  ini: "braces",
  cfg: "braces",
  conf: "braces",
  env: "braces",
  graphql: "braces",
  gql: "braces",
  tf: "braces",
  hcl: "braces",
  // 文档（画板 30 的 file-text：DESIGN-SPEC.md / README.md）
  md: "file-text",
  mdx: "file-text",
  txt: "file-text",
  rst: "file-text",
  log: "file-text",
  pdf: "file-text",
  doc: "file-text",
  docx: "file-text",
  rtf: "file-text",
  // 媒体与二进制
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  bmp: "image",
  ico: "image",
  avif: "image",
  heic: "image",
  svg: "image",
  zip: "file-archive",
  tar: "file-archive",
  gz: "file-archive",
  tgz: "file-archive",
  bz2: "file-archive",
  xz: "file-archive",
  rar: "file-archive",
  "7z": "file-archive",
  mp3: "music",
  wav: "music",
  flac: "music",
  ogg: "music",
  m4a: "music",
  mp4: "play",
  mov: "play",
  mkv: "play",
  webm: "play",
  avi: "play",
  // 数据表与凭据
  csv: "table",
  tsv: "table",
  xls: "table",
  xlsx: "table",
  sql: "database",
  db: "database",
  sqlite: "database",
  lock: "lock",
  pem: "lock",
  key: "lock",
};

function getSpecialFileIcon(name: string): LucideIconName | undefined {
  if (name === "dockerfile" || name.startsWith("dockerfile.") || name === "containerfile") return "box";
  if ([".gitignore", ".gitattributes", ".gitmodules"].includes(name)) return "git-branch";
  if (["package-lock.json", "bun.lock", "yarn.lock", "pnpm-lock.yaml", "cargo.lock"].includes(name)) return "lock";
  if (name === ".env" || name.startsWith(".env.")) return "braces";
  if (
    ["next.config.js", "next.config.mjs", "next.config.cjs", "next.config.ts"].includes(name)
    || [".eslintrc", ".eslintrc.js", ".eslintrc.json", ".eslintrc.yml", "eslint.config.mjs", "eslint.config.js"].includes(name)
  ) return "braces";
  if (name.endsWith(".config.ts") || name.endsWith(".config.js") || name.endsWith(".config.mjs") || name.endsWith(".config.cjs")) return "braces";
  return undefined;
}

export function getFileIcon(name: string, size = 14): React.ReactNode {
  const lower = name.toLowerCase();
  const specialIcon = getSpecialFileIcon(lower);
  if (specialIcon) return <Icon name={specialIcon} size={size} />;

  const ext = lower.split(".").pop() ?? "";
  const icon = EXTENSION_ICONS[ext];
  return <Icon name={icon ?? "file"} size={size} />;
}
