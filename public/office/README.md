# public/office —— GenOffice DOCX 编辑器（fork:office-editor）

本目录是 PI NEXT 内置的 Word 文档**编辑**能力。`.docx` 默认仍走 `FileViewer` 的只读
预览（服务端 mammoth）；用户点工具栏的铅笔按钮后，才在这个同源 iframe 里用
GenOffice 打开，可改可存，保存回原文件。

## 来源与许可

| 部分 | 来源 | 许可 |
|---|---|---|
| `assets/`（`index-*.js` / `index-*.css` / 33 个字体 / png） | [genspark-ai/genoffice](https://github.com/genspark-ai/genoffice/) | Apache-2.0（见 `LICENSE`） |
| 字体许可 | 见 `LICENSE-OFL.txt`、`LICENSE-UNICODE.txt` | OFL / Unicode |
| `vendor/fflate.js` | fflate 0.8.3 | MIT（见 `vendor/fflate-LICENSE.txt`） |
| `host.html` / `host.js` / 本文件 | 本仓 | GPL-3.0-or-later |

上游锁定提交与逐文件 sha256 记在 `provenance.json`。**本仓没有改上游产物的字节**：
`assets/` 与 `vendor/` 与 XTLaw 迁移时校验过的输入逐字一致。迁移参考实现是
XTLaw/Lexora 的预装插件 `plugins/office/`（`bridge.js` 是它把编辑器要的
`window.desktop` 接到宿主资源 API 的那一层）；本仓的 `host.js` 是按同一份接口契约
**重写**的宿主适配层，不是直接拷贝。

## 为什么字体路径要靠 rewrite

`assets/index-*.css` 里的字体、`assets/index-*.js` 里的 `send-enter-off-*.png` 都写成
**绝对路径** `/assets/*`（上游产物如此）。为了不动上游字节，`next.config.mjs` 里有一条
`rewrites()`：`/assets/:path*` → `/office/assets/:path*`。`public/assets/` 目前无人使用；
将来若要占用这个名字，先改掉那条 rewrite。

## 宿主适配层（`host.js`）

编辑器只认识 `window.desktop`。本仓把它接到 `/api/files`：

| 编辑器调用 | 本仓实现 |
|---|---|
| 打开 | `GET /api/files/<path>?type=download` → ArrayBuffer，作为虚拟文件 `{path, name, data}` |
| 保存当前文件 | `POST /api/files/<dir>?type=upload&conflict=overwrite`（multipart，原子替换） |
| 外部改动冲突 | 打开时记 `{size, mtimeMs}`（`?type=meta`），保存前比对，变了就拒绝覆盖 |
| 另存为 / 新建 | 浏览器下载一份副本（`<a download>`） |
| 其余方法 | Proxy 兜底成「不支持」，与上游插件桥接同一形状 |

父子通信（编辑页跑在 `FileViewer` 的 iframe 里）：

* `pi-office:check` → 回 `{dirty, autoSave, filePath}`
* `pi-office:flush` → 让编辑器把未保存改动写回，回 `{ok}`（切回预览前会先等它）

## 已知边界

* 保存前的外部改动检查是「读版本 → 写」两步，不是原子的；窗口期内被改仍可能覆盖。
* 关标签页时编辑器来不及 flush 的话，最后一次自动保存（30s 或失焦）之后的改动会丢。
  点编辑器外面会触发失焦自动保存，所以正常操作路径上是安全的。
* 编辑器自带 64 MiB / 128 MiB / 10000 条目的 ZIP 预算校验；`FileViewer` 的只读预览
  上限仍是 10 MiB，两者互不影响。
