# PI NEXT v0.1.3-beta.0.1

这一版把整套视觉语言换成统一的设计系统，并把主题**收敛成浅色 / 深色 / 跟随系统三档**：
配色、字号、圆角全部改由设计供给，明暗自动跟随，主题之间不再有「说不清是灰还是蓝」的中间态。
纯源码发布。

## 新增

- **语义色整套接入**：颜色槽位全部改由设计系统的语义色供给，不再是每处各写各的硬编码——
  同一个「次要文字」在画布、侧栏、弹窗里指的是同一个值。字号、行高、字距、字重也由成套的排版样式
  一次绑齐，同一层级的文字在各页不会长得不一样，明暗主题自动跟随。
- **对比度门禁**：新增一道自动检查，明暗两套共 8 组前景 / 背景组合都要达到 WCAG AA，不达标不算通过，
  以后不用再靠肉眼赌。
- **键盘焦点环**：消息操作行与输入区控件原先全是内联样式、没有可挂焦点的钩子，键盘用户既看不出焦点落在哪，
  也很难判断这里能不能操作，现在焦点走到哪、走到哪都能看见。
- **列表行入场动画**：列表行出现时带一段过渡；系统开启「减少动态效果」时自动关闭。
- **换 Inter 字体**：拉丁字符走 Inter，中文回退到苹方。

## 改动

- **主题只剩三档**：浅色 / 深色 / 跟随系统。明暗自动跟随，系统切到夜间，界面就跟着切，
  不用自己记得回来改一次。
- **圆角重新分配**：面板与弹窗用 24px 大圆角，控件与列表行维持 10 / 6px，两档之间差得更开，
  一眼分得出哪一层是浮在上面的。
- **用户气泡与输入区**：用户气泡改为 16px 圆角加轻阴影；输入区改成 24px 大圆角卡片，
  原来输入框与项目条焊在一起的「两段式」取消，两者的层级更分明。
- **不再读取命令行端主题**：主题只来自应用自身，不再读取命令行端的主题目录与内置主题注册表，
  免得两边的设置互相覆盖、你在这边选的主题被那边改掉。

## 移除

- **三套旧色板**：雾青 / 蔷薇 / 松夜三套色板删掉，主题只剩浅色 / 深色 / 跟随系统；
  已经存下来的旧主题偏好会自动回退，不会变成一块空白，也不会剩一个读不出来的设置项。

## 已知

- 本版是**源码发布**，没有桌面安装包，也没有现成的可执行文件；需要桌面版请自行打包。
- 发布物是完整源码压缩包，不含依赖目录；解压后装好依赖即可运行。
- 类型检查、测试、主题校验与对比度三套门禁全绿，生产构建通过。

---

## English

This version replaces the entire visual language with a unified design system, and **condenses themes into three options: light / dark / follow system**: colors, font sizes, and corner radius are all supplied by the design system, light and dark follow automatically, and there is no longer an in-between state between themes where you "can't tell if it's gray or blue". Pure source release.

### Added

- **Full semantic color integration**: all color slots are now supplied by the design system's semantic colors, no longer hardcoded separately in each place — the same "secondary text" refers to the same value on the canvas, sidebar, and dialogs. Font size, line height, letter spacing, and font weight are likewise bound together at once by a complete set of typography styles, so text at the same level does not look different across pages, and light/dark themes follow automatically.
- **Contrast gate**: a new automated check is added; all 8 foreground / background combinations across light and dark must reach WCAG AA, and failing that does not pass, so you no longer have to gamble with your eyes.
- **Keyboard focus ring**: the message action row and input-area controls were previously all inline styles with no hook to attach focus to, so keyboard users could neither see where focus landed nor easily tell whether an action was available here; now wherever focus goes, it can be seen.
- **List row entrance animation**: list rows appear with a transition; it turns off automatically when the system enables "reduce motion".
- **Switch to the Inter font**: Latin characters use Inter, with Chinese falling back to PingFang.

### Changed

- **Only three themes remain**: light / dark / follow system. Light and dark follow automatically; when the system switches to night mode, the interface switches along with it, so you don't have to remember to come back and change it yourself.
- **Corner radius redistributed**: panels and dialogs use a large 24px radius, while controls and list rows keep 10 / 6px, making the gap between the two tiers wider so you can tell at a glance which layer floats above.
- **User bubbles and input area**: user bubbles change to a 16px radius with a light shadow; the input area changes to a 24px large-radius card, and the former "two-segment" style that welded the input box and project bar together is cancelled, making the hierarchy between the two clearer.
- **No longer reads command-line-side themes**: themes come only from the app itself; it no longer reads the command-line side's theme directory and built-in theme registry, so the two sides' settings won't override each other and the theme you picked here won't be changed over there.

### Removed

- **Three old palettes**: the mist / rose / pine palettes are deleted, leaving only light / dark / follow system; already-saved old theme preferences fall back automatically, so they won't become a blank area or leave behind a settings entry that can't be read.

### Known

- This version is a **source release**, with no desktop installer package and no ready-made executable; if you need the desktop version, please package it yourself.
- The release artifact is a complete source archive and does not include the dependency directory; after extracting, install the dependencies and it can run.
- The three gates of type checking, tests, and theme validation plus contrast are all green, and the production build passes.
