# -*- coding: utf-8 -*-
"""设置家族 · 第二批规格（通用续 / 模型 / 技能 / MCP / 子代理 / 用量 / 定时）。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from settings import modal, section, card, row, sw, seg, btn, tag, mono, kv, table, fill, ICO

FRAMES = {}

FRAMES["web-settings-general"] = [
    ("B", "通用", "通用 · 上下文与容错", "上下文预算、重试、声音，都是「跑长任务时才会碰到」的那几项。", [
        ("上下文预算", card(
            row("自动压缩", "到阈值先压缩再继续", sw(True)) +
            row("阈值", "占用超过这个比例就压缩", seg(["60%", "75%", "90%"], 1)) +
            row("保留最近", "压缩时不动最后 N 轮", mono("6 轮")))),
        ("容错与重试", card(
            row("自动重试", "只对 429 / 5xx / 网络中断生效", sw(True)) +
            row("触发条件", "三种都能单独关", tag("429", True) + " " + tag("5xx", True) + " " + tag("超时", False)) +
            row("最多重试", "", mono("3 次")) +
            row("退避", "指数退避，最长 30s", mono("1s → 2s → 4s")))),
        ("声音与通知", card(
            row("完成提示音", "", sw(False)) +
            row("等待授权提示音", "长任务离开屏幕时有用", sw(True)))),
        ("进入方式", card(
            row("默认目录", "新会话默认落在这里", mono("~/Desktop/PI-NEXT")) +
            row("打开方式", "", seg(["当前窗口", "新窗口"], 0)))),
    ]),
    ("C", "通用", "通用 · 皮肤工作室", "四色与几何实时预览，选皮肤与重播都是真能点的。", [
        ("皮肤", card(
            row("当前皮肤", "System", seg(["System", "Mist", "Dusk"], 0)) +
            row("强调色", "", tag("蓝", True) + " " + tag("绿") + " " + tag("橙") + " " + tag("紫")))),
        ("几何", card(
            row("窗口圆角", "", mono("26 px")) +
            row("行高", "", mono("28 px")) +
            row("正文字号", "", seg(["13", "14", "15"], 1)))),
        ("实时预览", card(
            '<div style="padding:14px 16px">'
            '<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">'
            '<span class="tag is-on">强调色</span><span class="tag">次色</span>'
            '<span style="flex:1"></span><button class="btn">重播</button></div>'
            '<div class="card" style="padding:12px 14px;font-size:12px;line-height:1.7;color:var(--ink-2)">'
            '这一块用的是当前皮肤的真实令牌，改上面的色就跟着变。</div></div>')),
        ("自定义 CSS", card(
            row("自定义样式", "只影响外观，不改行为", btn("编辑")))),
    ]),
    ("D", "通用", "设置 · 弹窗形态", "同一份内容放进弹窗：外面是遮罩与关闭条，里面仍是可编辑的。", [
        ("为什么是弹窗", card(
            row("会话不动", "关掉就回到原来的位置，不重新加载", tag("不打断", True)) +
            row("唯一宿主", "独立设置页已废止，只保留这一种形态", tag("已收敛", True)))),
        ("快捷键", card(
            row("打开设置", "", mono("⌘K → 设置")) +
            row("关闭", "", mono("Esc")))),
    ]),
]

FRAMES["web-settings-models"] = [
    ("B", "模型", "模型 · 编辑", "上下文 / 输出 / 模态 / 推理档位 / 请求头 / 兼容开关，一页看全。", [
        ("上限", card(
            row("上下文窗口", "", mono("200 000")) +
            row("最大输出", "", mono("64 000")) +
            row("模态", "", tag("文本", True) + " " + tag("图片", True) + " " + tag("音频", False)))),
        ("推理档位", card(
            row("默认", "", seg(["关", "低", "中", "高", "极高", "最大"], 2)))),
        ("请求头", card(
            row("User-Agent", "只对这一个模型", mono("pi-web/0.12.2")) +
            row("X-Title", "", mono("Pi Web")))),
        ("兼容", card(
            row("合并同角色消息", "关掉后 Anthropic 会拒收", sw(True)) +
            row("去掉 strict", "老网关需要", sw(False)))),
    ]),
    ("C", "模型", "模型 · 默认分工", "三张卡：默认 / 命名 / 压缩，各点开选型器。", [
        ("默认模型", card(
            row("会话主模型", "新会话默认用它", mono("claude-sonnet-4.6") + " " + btn("选型")))),
        ("命名模型", card(
            row("生成标题", "用小模型就够", mono("claude-haiku-4.5") + " " + btn("选型")))),
        ("压缩模型", card(
            row("上下文压缩", "长会话压缩用", mono("claude-haiku-4.5") + " " + btn("选型")))),
        ("成本档", card(
            row("当前档位", "按近 30 天用量估", seg(["省", "平衡", "快"], 1)))),
    ]),
    ("D", "模型", "模型 · 启用范围", "pattern 就是 pi 的 --models 写法；命中与钉档写在同一行。", [
        ("白名单", table(
            ["pattern", "命中", "钉档"],
            [[mono("claude-*"), "4", "中"], [mono("gpt-5*"), "2", "高"], [mono("deepseek-*"), "1", "关"]])),
        ("失配诊断", card(
            row("kimi-k*", "提供方里叫 kimi-k3，前缀对不上", btn("改") + " " + btn("删")))),
    ]),
]

FRAMES["web-settings-skills"] = [
    ("B", "技能", "技能 · 商店", "分类过滤 + 卡片网格，点卡片看详情。", [
        ("分类", card(row("筛选", "", seg(["全部", "写作", "工程", "数据"], 0)))),
        ("可安装", card(
            row("pdf", "读写 PDF · 官方 · 4.2k 次安装", btn("安装")) +
            row("sheet", "表格分析 · 官方 · 2.8k", btn("安装")) +
            row("docx", "Word 排版 · 官方 · 1.9k", btn("安装")))),
        ("已装但关着", card(
            row("legacy-lsp", "关掉 ≠ 卸载，随时能开", btn("启用")))),
    ]),
    ("C", "技能", "技能 · 内容查看", "文件清单 → 渲染正文 → 原文与 frontmatter，三段能切。", [
        ("pdf", card(
            row("SKILL.md", "2.4 KB", btn("查看")) +
            row("scripts/extract.py", "6.1 KB", btn("查看")) +
            row("三段", "", seg(["正文", "原文", "frontmatter"], 0)))),
        ("正文", card(
            '<div style="padding:12px 16px;font-size:12px;line-height:1.8;color:var(--ink-2)">'
            '把 PDF 抽成 markdown 再交给模型；扫描件先走 OCR，失败就退化成逐页图片。</div>')),
    ]),
    ("D", "技能", "技能 · 目录与信任", "目录优先级、信任粒度、发现顺序，三件事分开写。", [
        ("目录", card(
            row("~/.pi/skills", "用户级 · 优先级 1", sw(True)) +
            row(".pi/skills", "项目级 · 优先级 2", sw(True)) +
            row("内置", "随 pi 发布 · 只读", tag("只读")))),
        ("信任", card(
            row("信任粒度", "按目录，不按单个技能", seg(["目录", "技能"], 0)))),
    ]),
]

FRAMES["web-settings-mcp"] = [
    ("B", "MCP 服务器", "MCP · 新增", "三个入口 + 作用域三选一；保存时不写死传输方式。", [
        ("入口", card(
            row("粘贴 JSON", "最快，从别处复制过来", seg(["粘贴", "基础", "高级"], 0)))),
        ("作用域", card(
            row("装在哪", "全局所有人可用 / 只这个项目", seg(["全局", "项目"], 0)))),
        ("基础配置", card(
            row("名称", "", mono("filesystem")) +
            row("命令", "", mono("npx -y @modelcontextprotocol/server-filesystem")) +
            row("传输", "按命令自动判断，不写死", tag("自动", True)))),
        ("保存", card(
            '<div class="crow"><span class="crow__title"></span><div class="crow__control">'
            + btn("取消") + " " + btn("保存并启用", "btn--prom") + '</div></div>')),
    ]),
    ("C", "MCP 服务器", "MCP · 粘贴解析", "逐条写清翻译了什么、丢了什么、为什么不接受。", [
        ("解析结果", card(
            row("mcpServers.filesystem", "翻译成 1 个 stdio 服务器", tag("接受", True)) +
            row("env.API_KEY", "值看起来是占位符，已保留", tag("保留")) +
            row("headers.Authorization", "http 传输才用，这里丢了", tag("忽略")))),
        ("筛选", card(row("只看", "", seg(["全部", "接受", "忽略"], 0)))),
    ]),
    ("D", "MCP 服务器", "MCP · 登录态与日志", "三档筛选 + 每页 50 行，分页器真实存在。", [
        ("OAuth", card(
            row("github", "已授权 · 2 小时前刷新", btn("重新授权")))),
        ("日志", card(
            row("筛选", "", seg(["全部", "错误", "慢调用"], 1)) +
            row("list_dir · 128ms", "2026-10-25 12:31", tag("ok", True)) +
            row("search_repos · 超时", "2026-10-25 12:28", tag("错误")))),
        ("分页", card(
            '<div class="crow"><span class="crow__title">1–50 / 312</span><div class="crow__control">'
            + btn("上一页") + " " + btn("下一页") + '</div></div>')),
    ]),
]

FRAMES["web-settings-agents"] = [
    ("A", "子代理", "子代理 · 总开关", "默认关；切换后需要重载会话，三种运行形态并列。", [
        ("总开关", card(
            row("启用子代理", "切换后需重载会话才生效", sw(False)))),
        ("运行形态", card(
            row("形态", "并发 / 串行 / 手动", seg(["并发", "串行", "手动"], 0)) +
            row("并发上限", "", mono("3")))),
    ]),
    ("B", "子代理", "子代理 · profile", "名称 / 描述 / 模型 / 思考 / max turns 一行看清。", [
        ("profile", table(
            ["名称", "描述", "模型", "思考", "max turns"],
            [["explore", "只读探索", "haiku-4.5", "关", "40"],
             ["builder", "写代码", "sonnet-4.6", "中", "120"],
             ["reviewer", "只读评审", "sonnet-4.6", "高", "60"]])),
        ("新建", card(row("新建 profile", "从模板起手", btn("新建")))),
    ]),
    ("C", "子代理", "子代理 · 工具白名单", "内外置工具两种底色分开，点芯片即切换。", [
        ("内置", card(
            row("read / edit / bash", "内置工具", tag("read", True) + " " + tag("edit", True) + " " + tag("bash", False)))),
        ("扩展", card(
            row("来自插件", "关掉插件后这里会消失", tag("apply_patch", True) + " " + tag("mcp__github", False)))),
    ]),
    ("D", "子代理", "子代理 · 运行中", "每个子代理一行，状态与耗时写在行尾。", [
        ("运行中", card(
            row("explore · 只读探索", "读了 12 个文件", tag("运行中", True)) +
            row("builder · 写代码", "等你授权 rm -rf", tag("待授权")))),
        ("结束", card(
            row("reviewer", "用时 1m 12s · 0 个问题", tag("完成", True)))),
    ]),
]

FRAMES["web-settings-usage"] = [
    ("A", "用量", "用量 · 首页", "四档范围 + 四张统计卡 + 模型占比。", [
        ("范围", card(row("时间范围", "", seg(["今天", "7 天", "30 天", "全部"], 1)))),
        ("统计", card(
            '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:12px 14px">'
            '<div class="stat"><span class="t-xs t-faint">请求</span><b>1 284</b></div>'
            '<div class="stat"><span class="t-xs t-faint">输入 token</span><b>8.4M</b></div>'
            '<div class="stat"><span class="t-xs t-faint">输出 token</span><b>612k</b></div>'
            '<div class="stat"><span class="t-xs t-faint">费用</span><b>¥142.60</b></div></div>')),
        ("模型占比", card(
            row("claude-sonnet-4.6", "62% · ¥88.40", '<span class="bar" style="width:120px"><i style="width:62%"></i></span>') +
            row("claude-haiku-4.5", "31% · ¥44.10", '<span class="bar" style="width:120px"><i style="width:31%"></i></span>') +
            row("其他", "7% · ¥10.10", '<span class="bar" style="width:120px"><i style="width:7%"></i></span>'))),
    ]),
    ("B", "用量", "用量 · 年度热力图", "364 天，每格 1 天，按 26 天一行折叠。", [
        ("活跃", card(
            '<div style="padding:14px 16px">'
            '<div class="heat-grid" style="grid-template-columns:repeat(26,1fr)">'
            + "".join('<i class="%s"></i>' % ("l3" if i % 7 == 0 else "l2" if i % 3 == 0 else "l1" if i % 2 == 0 else "")
                      for i in range(104))
            + '</div>'
            '<div style="margin-top:10px;font-size:11px;color:var(--ink-3)">少 ← 每天请求数 → 多</div></div>')),
        ("口径", card(
            row("一格", "一天", tag("364 格")) +
            row("折叠", "26 天一行的横向折行", tag("不是按周")))),
    ]),
    ("C", "用量", "用量 · 每日曲线", "柱条自基线长起，30 根逐根错峰。", [
        ("每日 token", card(
            '<div style="padding:14px 16px"><div class="bars">'
            + "".join('<i style="height:%d%%"%s></i>' % (30 + (i * 37) % 70, ' class="is-on"' if i == 27 else "")
                      for i in range(30))
            + '</div><div style="margin-top:8px;font-size:11px;color:var(--ink-3)">9-26 → 10-25</div></div>')),
        ("每日费用", card(
            row("峰值", "10-24 · ¥18.20", tag("最高", True)) +
            row("均值", "¥4.75 / 天", tag("30 天")))),
    ]),
    ("D", "用量", "用量 · 明细", "两张表：按项目聚合 / 失败请求；点行能选中。", [
        ("按项目", table(
            ["项目", "请求", "费用"],
            [["PI-NEXT", "902", "¥104.30"], ["pi-codex", "312", "¥31.20"], ["tivano", "70", "¥7.10"]])),
        ("失败", table(
            ["时间", "错误", "重试"],
            [["12:28", "429 rate_limit", "1 次后成功"], ["11:02", "timeout 60s", "未重试"]])),
    ]),
]

FRAMES["web-settings-automation"] = [
    ("A", "定时任务", "定时任务 · 列表", "开关 / 调度徽章 / 下次运行 / 上次结果；失败与延后分开。", [
        ("任务", card(
            row("每天 9:00 跑 typecheck", "下次 明天 9:00 · 上次 成功", sw(True)) +
            row("每周一整理 release notes", "下次 周一 10:00 · 上次 已跳过", sw(True)) +
            row("每 30 分钟看一次 CI", "连续失败 3 次，已自动暂停", sw(False)))),
        ("暂停提示", card(
            row("连续失败已暂停", "3 次都是同一条命令超时", tag("自动", True)))),
    ]),
    ("B", "定时任务", "定时任务 · 编辑器", "调度四选一，切了才换字段；暂停阈值是滑杆。", [
        ("调度", card(
            row("频率", "", seg(["一次", "每天", "每周", "间隔"], 1)) +
            row("时间", "", mono("09:00")) +
            row("时区", "", mono("Asia/Shanghai")))),
        ("归属", card(
            row("子会话", "每次跑都开一条新会话", sw(True)) +
            row("失败重试", "", mono("2 次")))),
        ("自动暂停", card(
            row("连续失败阈值", "到阈值就暂停并通知", mono("3 次")))),
    ]),
    ("C", "定时任务", "定时任务 · 运行历史", "状态筛选 + 每页 20 条；四种结局一眼分开。", [
        ("筛选", card(row("状态", "", seg(["全部", "成功", "失败", "跳过"], 0)))),
        ("记录", table(
            ["时间", "结局", "耗时"],
            [["10-25 09:00", "成功", "1m 12s"], ["10-24 09:00", "失败 · 超时", "60s"],
             ["10-23 09:00", "已延后", "—"], ["10-22 09:00", "已跳过", "—"]])),
    ]),
    ("D", "定时任务", "定时任务 · 单次详情", "指令快照 / 步骤耗时 / 失败判据 / 三种重跑。", [
        ("指令快照", card(
            row("运行时用的指令", "任务改了也不影响这次记录", mono("npm run typecheck")))),
        ("失败判据", card(
            row("为什么判失败", "退出码 1，输出里有 TS2307", tag("退出码", True)))),
        ("重跑", card(
            '<div class="crow"><span class="crow__title"></span><div class="crow__control">'
            + btn("原样重跑") + " " + btn("用当前指令重跑") + " " + btn("只跑这一步", "btn--prom") + '</div></div>')),
    ]),
]
