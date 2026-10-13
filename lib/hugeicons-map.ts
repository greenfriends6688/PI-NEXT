/**
 * fork:fastvibe-stack (H3) —— lucide 图标名 → Hugeicons 组件的映射表。
 *
 * ## 为什么需要这张表
 *
 * 本仓的图标一直是**间接层**：组件里写 `<i data-ico="search">`，运行时由
 * `components/PwIcons.tsx` 的 MutationObserver 把 lucide 的 SVG 路径灌进去
 * （940 处调用点，155 个名字）。FastVibe 用的是**直接 JSX**：
 * `<HugeiconsIcon icon={Search01Icon} className="size-4" />`。
 *
 * 换图标库因此有两条路：① 保留 data-ico 间接层，把 icons.js 的路径数据换成
 * Hugeicons 的（940 处不动）；② 逐处改写成 `<HugeiconsIcon>`（最接近原样，
 * 但要动 940 处）。计划裁定的是 **H3 先做映射表 + 双轨共存，② 分批跟 L 批次走** ——
 * 这个文件就是那条双轨的中间层：`iconPath()` 按 lucide 名取到 Hugeicons 的
 * SVG 元素数组，交给现有 hydrator 画进 `<i data-ico>`。
 *
 * ## 名字怎么来的
 *
 * 152 个名字全部经脚本核对过（`@hugeicons/core-free-icons` 的导出集）：
 * 140 个是「lucide 名转 PascalCase + Icon 后缀」的直译，12 个是人工挑的近似语义
 * —— 后者在 `ICON_OVERRIDES` 里单列，改名前先看那里的理由。
 *
 * ## 与 FastVibe 的差异
 *
 * FastVibe 用 84 个 Hugeicons 就够，本仓用到 152 个 —— 因为本仓的功能面更宽
 * （文档 / 终端 / Git / DAG / 多种推送渠道）。所以这不是「抄它的清单」，
 * 而是「把本仓用到的名字映射到同一套图标里」。
 */

import {
  ActivityIcon, AlertCircleIcon, ArchiveIcon, ArchiveRestoreIcon, ArrowDownIcon, ArrowLeftIcon, ArrowLeftRightIcon, ArrowUpDownIcon,
  ArrowUpIcon, ArrowUpRightIcon, AtSignIcon, BanIcon, BlocksIcon, BookMarkedIcon, BookOpenIcon, BotIcon,
  BoxIcon, BracesIcon, BrainIcon, CalendarClockIcon, CalendarDaysIcon, ChartColumnIncreasingIcon, CheckCheckIcon, CheckIcon,
  ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronUpIcon, ChevronsRightLeftIcon, CircleCheckIcon, CircleIcon, CircleMinusIcon,
  CircleQuestionMarkIcon, CircleSlashIcon, CircleXIcon, ClipboardListIcon, ClockIcon, CodeIcon, ColumnsThreeCogIcon, CommandIcon,
  ComputerScreenShareIcon, CopyIcon, CornerDownRightIcon, CursorTextIcon, Delete02Icon, DownloadIcon, EllipsisIcon, EllipsisVerticalIcon,
  EraserIcon, ExternalLinkIcon, EyeIcon, FileClockIcon, FileCodeIcon, FileDiffIcon, FileIcon, FilePlusIcon,
  FileTextIcon, FlameIcon, FolderCogIcon, FolderIcon, FolderOpenIcon, FolderPlusIcon, FolderSearchIcon, FolderTreeIcon,
  FunctionSquareIcon, GaugeIcon, GitBranchIcon, GitCommitHorizontalIcon, GitCompareIcon, GitForkIcon, GitMergeIcon, GlobeIcon,
  Grid2x2Icon, GripVerticalIcon, HardDriveIcon, HashIcon, HistoryIcon, ImageIcon, ImportIcon, InboxIcon,
  InfoIcon, KeyRoundIcon, KeyboardIcon, LayersIcon, LinkIcon, ListChecksIcon, ListFilterIcon, ListIcon,
  ListTodoIcon, ListTreeIcon, LoaderCircleIcon, LockIcon, LogOutIcon, MaximizeIcon, MenuIcon, MessageCircleIcon,
  MessageSquareIcon, MessagesSquareIcon, MinimizeIcon, MinusIcon, MoveDiagonalIcon, MusicIcon, PackageIcon, PaintbrushIcon,
  PanelLeftIcon, PanelRightIcon, PaperclipIcon, PauseIcon, PencilIcon, PencilLineIcon, PercentIcon, PieChart01Icon,
  PinIcon, PlayCircleIcon, PlayIcon, PlugIcon, PlusIcon, PowerIcon, RefreshCwIcon, RotateCwIcon,
  Rows3Icon, SaveIcon, ScanSearchIcon, SearchIcon, SendIcon, ServerIcon, SettingsIcon, ShieldAlertIcon,
  ShieldCheckIcon, ShieldQuestionMarkIcon, SigmaIcon, SlashIcon, SlidersHorizontalIcon, SmartphoneIcon, SparkleIcon, SparklesIcon,
  SquareMousePointerIcon, SquarePenIcon, SquareTerminalIcon, StarIcon, TableIcon, TerminalIcon, TimerIcon, TriangleAlertIcon,
  Undo02Icon, UploadIcon, WandSparklesIcon, WrenchIcon, XIcon, ZapIcon, ZoomInIcon, ZoomOutIcon,
} from "@hugeicons/core-free-icons";

/**
 * 手工挑选的映射（不平滑地走「PascalCase + Icon」直译的那 12 个）。
 *
 * 每一个都是「lucide 的语义在 Hugeicons 里的对应物」，不是随便挑一个形似的：
 * 挑错的后果是图标读起来是另一件事（比如把「问号盾牌」画成「警告盾牌」）。
 */
const ICON_OVERRIDES: Record<string, string> = {
  // lucide 是「双向箭头」，Hugeicons 的 ArrowLeftRightIcon 就是它
  "arrow-right-left": "ArrowLeftRightIcon",
  // lucide 是「圆圈+问号」；Hugeicons 把这个概念叫 QuestionMark
  "circle-help": "CircleQuestionMarkIcon",
  // 同上：盾牌 + 问号
  "shield-question": "ShieldQuestionMarkIcon",
  // lucide 的 chart-pie；Hugeicons 只有 PieChart01..03，取最贴的一版
  "chart-pie": "PieChart01Icon",
  // lucide 的「上下双箭头」= Hugeicons 的 ArrowUpDown
  "chevrons-up-down": "ArrowUpDownIcon",
  // 圆圈 + 感叹号：Hugeicons 的命名是 AlertCircle（词序相反）
  "circle-alert": "AlertCircleIcon",
  // 圆圈 + 播放
  "circle-play": "PlayCircleIcon",
  // lucide 的 columns-2（两栏布局）；Hugeicons 没有正好两栏，取三栏配置版
  // —— 这个图标在本仓只用于「分栏视图」的示意，栏数不是语义的一部分
  "columns-2": "ColumnsThreeCogIcon",
  // maximize-2 / minimize-2 是 lucide 的「四角箭头」；Hugeicons 无编号版即可
  "maximize-2": "MaximizeIcon",
  "minimize-2": "MinimizeIcon",
  // share-2 是「共享给他人」，不是「分享到社交」—— 取屏幕共享
  "share-2": "ComputerScreenShareIcon",
  // lucide 的方框 + f(x)
  "square-function": "FunctionSquareIcon",
  // lucide 的文本光标
  "text-cursor": "CursorTextIcon",
  // trash-2 是「带线条的垃圾桶」（区别于无线条版）；Hugeicons 用编号
  "trash-2": "Delete02Icon",
  // undo-2 同理
  "undo-2": "Undo02Icon",
};

/**
 * lucide 名 → Hugeicons 组件。键是本仓产品里实际写过的 152 个名字
 * （`grep -rho 'data-ico="[^"]*"'` 的结果），不是 icons.js 的全部 256 个 ——
 * 画板专属的那些（只有设计稿在用）不进产品包。
 */
export const ICON_MAP = {
  "activity": ActivityIcon,
  "archive": ArchiveIcon,
  "archive-restore": ArchiveRestoreIcon,
  "arrow-down": ArrowDownIcon,
  "arrow-left": ArrowLeftIcon,
  "arrow-right-left": ArrowLeftRightIcon,
  "arrow-up": ArrowUpIcon,
  "arrow-up-right": ArrowUpRightIcon,
  "at-sign": AtSignIcon,
  "ban": BanIcon,
  "blocks": BlocksIcon,
  "book-marked": BookMarkedIcon,
  "book-open": BookOpenIcon,
  "bot": BotIcon,
  "box": BoxIcon,
  "braces": BracesIcon,
  "brain": BrainIcon,
  "calendar-clock": CalendarClockIcon,
  "calendar-days": CalendarDaysIcon,
  "chart-column-increasing": ChartColumnIncreasingIcon,
  "chart-pie": PieChart01Icon,
  "check": CheckIcon,
  "check-check": CheckCheckIcon,
  "chevron-down": ChevronDownIcon,
  "chevron-left": ChevronLeftIcon,
  "chevron-right": ChevronRightIcon,
  "chevron-up": ChevronUpIcon,
  "chevrons-right-left": ChevronsRightLeftIcon,
  "chevrons-up-down": ArrowUpDownIcon,
  "circle": CircleIcon,
  "circle-alert": AlertCircleIcon,
  "circle-check": CircleCheckIcon,
  "circle-help": CircleQuestionMarkIcon,
  "circle-minus": CircleMinusIcon,
  "circle-play": PlayCircleIcon,
  "circle-slash": CircleSlashIcon,
  "circle-x": CircleXIcon,
  "clipboard-list": ClipboardListIcon,
  "clock": ClockIcon,
  "code": CodeIcon,
  "columns-2": ColumnsThreeCogIcon,
  "command": CommandIcon,
  "copy": CopyIcon,
  "corner-down-right": CornerDownRightIcon,
  "download": DownloadIcon,
  "ellipsis": EllipsisIcon,
  "ellipsis-vertical": EllipsisVerticalIcon,
  "eraser": EraserIcon,
  "external-link": ExternalLinkIcon,
  "eye": EyeIcon,
  "file": FileIcon,
  "file-clock": FileClockIcon,
  "file-code": FileCodeIcon,
  "file-diff": FileDiffIcon,
  "file-plus": FilePlusIcon,
  "file-text": FileTextIcon,
  "flame": FlameIcon,
  "folder": FolderIcon,
  "folder-cog": FolderCogIcon,
  "folder-open": FolderOpenIcon,
  "folder-plus": FolderPlusIcon,
  "folder-search": FolderSearchIcon,
  "folder-tree": FolderTreeIcon,
  "gauge": GaugeIcon,
  "git-branch": GitBranchIcon,
  "git-commit-horizontal": GitCommitHorizontalIcon,
  "git-compare": GitCompareIcon,
  "git-fork": GitForkIcon,
  "git-merge": GitMergeIcon,
  "globe": GlobeIcon,
  "grid-2x2": Grid2x2Icon,
  "grip-vertical": GripVerticalIcon,
  "hard-drive": HardDriveIcon,
  "hash": HashIcon,
  "history": HistoryIcon,
  "image": ImageIcon,
  "import": ImportIcon,
  "inbox": InboxIcon,
  "info": InfoIcon,
  "key-round": KeyRoundIcon,
  "keyboard": KeyboardIcon,
  "layers": LayersIcon,
  "link": LinkIcon,
  "list": ListIcon,
  "list-checks": ListChecksIcon,
  "list-filter": ListFilterIcon,
  "list-todo": ListTodoIcon,
  "list-tree": ListTreeIcon,
  "loader-circle": LoaderCircleIcon,
  "lock": LockIcon,
  "log-out": LogOutIcon,
  "maximize-2": MaximizeIcon,
  "menu": MenuIcon,
  "message-circle": MessageCircleIcon,
  "message-square": MessageSquareIcon,
  "messages-square": MessagesSquareIcon,
  "minimize-2": MinimizeIcon,
  "minus": MinusIcon,
  "move-diagonal": MoveDiagonalIcon,
  "music": MusicIcon,
  "package": PackageIcon,
  "paintbrush": PaintbrushIcon,
  "panel-left": PanelLeftIcon,
  "panel-right": PanelRightIcon,
  "paperclip": PaperclipIcon,
  "pause": PauseIcon,
  "pencil": PencilIcon,
  "pencil-line": PencilLineIcon,
  "percent": PercentIcon,
  "pin": PinIcon,
  "play": PlayIcon,
  "plug": PlugIcon,
  "plus": PlusIcon,
  "power": PowerIcon,
  "refresh-cw": RefreshCwIcon,
  "rotate-cw": RotateCwIcon,
  "rows-3": Rows3Icon,
  "save": SaveIcon,
  "scan-search": ScanSearchIcon,
  "search": SearchIcon,
  "send": SendIcon,
  "server": ServerIcon,
  "settings": SettingsIcon,
  "share-2": ComputerScreenShareIcon,
  "shield-alert": ShieldAlertIcon,
  "shield-check": ShieldCheckIcon,
  "shield-question": ShieldQuestionMarkIcon,
  "sigma": SigmaIcon,
  "slash": SlashIcon,
  "sliders-horizontal": SlidersHorizontalIcon,
  "smartphone": SmartphoneIcon,
  "sparkle": SparkleIcon,
  "sparkles": SparklesIcon,
  "square-function": FunctionSquareIcon,
  "square-mouse-pointer": SquareMousePointerIcon,
  "square-pen": SquarePenIcon,
  "square-terminal": SquareTerminalIcon,
  "star": StarIcon,
  "table": TableIcon,
  "terminal": TerminalIcon,
  "text-cursor": CursorTextIcon,
  "timer": TimerIcon,
  "trash-2": Delete02Icon,
  "triangle-alert": TriangleAlertIcon,
  "undo-2": Undo02Icon,
  "upload": UploadIcon,
  "wand-sparkles": WandSparklesIcon,
  "wrench": WrenchIcon,
  "x": XIcon,
  "zap": ZapIcon,
  "zoom-in": ZoomInIcon,
  "zoom-out": ZoomOutIcon,
} as const;
