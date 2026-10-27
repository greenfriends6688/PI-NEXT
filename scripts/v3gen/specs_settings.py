# -*- coding: utf-8 -*-
"""设置家族 · 帧规格。每帧只写「左边高亮哪项 + 右边这一页」。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from settings import (modal, section, card, row, sw, seg, btn, tag, mono, kv, table, fill, ICO)

GALLERY = '''              <div class="crow">
                <span class="crow__title">内置画廊</span>
                <span class="crow__detail">点一张就换，不用先保存</span>
                <span class="crow__control">
                  <span style="display:flex;gap:6px">
                    <span style="width:56px;height:36px;border-radius:8px;background:linear-gradient(135deg,#dfe7f5,#8ea3c4);box-shadow:inset 0 0 0 1px var(--line)"></span>
                    <span style="width:56px;height:36px;border-radius:8px;background:linear-gradient(135deg,#f3e6d8,#c39d78);box-shadow:inset 0 0 0 1px var(--line)"></span>
                    <span style="width:56px;height:36px;border-radius:8px;background:linear-gradient(135deg,#d8f3e6,#78c39d);box-shadow:inset 0 0 0 2px var(--accent)"></span>
                    <span style="width:56px;height:36px;border-radius:8px;background:linear-gradient(135deg,#e6d8f3,#9d78c3);box-shadow:inset 0 0 0 1px var(--line)"></span>
                  </span>
                </span>
              </div>'''

FRAMES = {}

FRAMES["web-settings-general-detail"] = [
    ("A", "通用", "通用 · 外观", "壁纸管窗口底色，主题只管强调色 —— 两块抢同一件事，所以挨着放。", [
        ("壁纸", card(
            row("启用壁纸", "关掉就是纯色底，玻璃仍按主题洗色", sw(True)) +
            row("当前壁纸", mono("droppy-dune.jpg") + " · 2560×1600", btn("更换") + " " + btn("移除")) +
            GALLERY)),
        ("侧边栏", card(
            row("宽度", "窄 240 / 标准 268 / 宽 300", seg(["窄", "标准", "宽"], 1)) +
            row("文件区", "关掉后侧栏只剩会话树", sw(True)))),
        ("界面字体", card(
            row("字号", "只影响界面，不改对话正文", seg(["小", "标准", "大"], 1)) +
            row("等宽数字", "时间、条数、成本对齐用", sw(True)))),
    ]),
    ("B", "通用", "通用 · 聊天", "聊天这 11 行是日常改得最多的，按「先看后写」排。", [
        ("会话", card(
            row("自动命名", "新会话发完第一条自动起名", sw(True)) +
            row("命名模型", "用小模型就够，别烧主模型", mono("claude-haiku-4.5")) +
            row("显示思考", "折叠头里的「思考过程」", sw(True)))),
        ("排版", card(
            row("密度", "紧凑会砍掉 4px 行距", seg(["舒适", "紧凑"], 0)) +
            row("步骤展开", "三个独立开关，不是一个单选组", tag("工具调用") + " " + tag("思考", True) + " " + tag("文件改动")) +
            row("正文宽度", "820 是画板定的理想列宽", mono("820 px")) +
            row("正文字号", "", seg(["13", "14", "15"], 1)) +
            row("扩展字号", "只放大代码块与表格", sw(False)))),
        ("输入", card(
            row("选中操作条", "选中正文时浮出复制 / 引用", sw(True)) +
            row("发送键", "Enter 发送 / ⌘Enter 发送", seg(["Enter", "⌘Enter"], 0)))),
    ]),
    ("C", "通用", "通用 · 通知与工具", "总开关关掉时，四个子项变禁用而不是各自清零 —— 用户回来还在。", [
        ("通知", card(
            row("总开关", "关掉后下面四项全部禁用", sw(False)) +
            row("回合完成", "长任务跑完弹一条", sw(True)) +
            row("等待授权", "命令要点头时弹", sw(True)) +
            row("出错", "工具失败时弹", sw(True)) +
            row("后台推送", "手机端收，需要先配对", sw(False)))),
        ("Shell 工具（仅 Windows）", card(
            row("PowerShell", "关掉后 bash 走 Git Bash", sw(True)) +
            row("Code mode", "自动 / 总是", seg(["自动", "总是"], 0)))),
        ("后台推送注册", card(
            row("这台设备", "已注册 · 上次推送 2 小时前", btn("注销")) +
            row("配对手机", "扫码后在手机上确认", btn("显示二维码", "btn--prom")))),
    ]),
    ("D", "通用", "通用 · 七块的条件", "一块消失只有两种条件：本机不可能有，或用户明确关掉。", [
        ("块的依赖", table(
            ["块", "出现的条件", "消失的条件"],
            [["壁纸", "永远", "—"],
             ["侧边栏", "永远", "—"],
             ["界面字体", "永远", "—"],
             ["聊天", "永远", "—"],
             ["通知", "永远", "关掉总开关后变禁用，不消失"],
             ["Shell 工具", "platform === win32", "非 Windows 直接不渲染"],
             ["后台推送", "支持 Push API", "浏览器不支持则整块不渲染"]])),
        ("为什么不做成单选组", card(
            row("三个「步骤展开」", "工具 / 思考 / 文件改动可以同时展开", tag("独立开关", True)) +
            row("推理档位", "那是六选一，才用分段", seg(["低", "中", "高"], 1)))),
    ]),
]

FRAMES["web-settings-models-advanced"] = [
    ("A", "模型", "模型 · 请求头", "请求头按行增删，每行标来源：全局 / 提供方 / 这一个模型。", [
        ("请求头与标识", card(
            row("HTTP-Referer", "来源：全局", mono("https://pi.dev") + " " + btn("删")) +
            row("X-Title", "来源：提供方 Anthropic", mono("Pi Web") + " " + btn("删")) +
            row("User-Agent", "来源：这一个模型（覆盖前两层）", mono("pi-web/0.12.2") + " " + btn("删")) +
            '<div class="crow"><span class="crow__title">加一行</span><span class="crow__detail">从预设里挑，或自己写</span><span class="crow__control">' + btn("加一行") + '</span></div>')),
        ("生效顺序", card(
            row("覆盖规则", "同名键按 全局 → 提供方 → 模型 逐层覆盖", tag("后者胜", True)) +
            row("预览", "实际发出去的三个头", mono("HTTP-Referer · X-Title · User-Agent")))),
    ]),
    ("B", "模型", "模型 · 兼容模式", "三档预设 + 五个开关，每个开关都写清关掉会少什么。", [
        ("预设", card(
            row("兼容档", "大多数第三方网关用「宽松」就够", seg(["严格", "宽松", "原生"], 1)))),
        ("逐项", card(
            row("去掉 tools 里的 strict", "关掉后部分网关不再 400", sw(True)) +
            row("合并连续同角色消息", "关掉后 Anthropic 会拒收", sw(True)) +
            row("把 system 提到首条 user", "关掉后老网关读不到指令", sw(False)) +
            row("去掉图片的 detail 字段", "关掉后视觉模型可能降级", sw(True)) +
            row("流式补一个空 chunk", "关掉后个别网关不结束", sw(False)))),
    ]),
    ("C", "模型", "模型 · 上限与形态", "上下文 / 最大输出 / 模态 / 覆盖地址，下面再接推理档位。", [
        ("上限", card(
            row("上下文窗口", "", mono("200 000 tokens")) +
            row("最大输出", "", mono("64 000 tokens")) +
            row("模态", "", tag("文本", True) + " " + tag("图片", True) + " " + tag("音频")))),
        ("API 覆盖地址", card(
            row("Base URL", "留空走提供方默认", mono("https://api.anthropic.com/v1")) +
            row("路径", "", mono("/messages")))),
        ("推理档位", card(
            row("默认档", "六段真的能切", seg(["关", "低", "中", "高", "极高", "最大"], 2)) +
            row("每档多什么", "关 = 不发 thinking；中 = budget 4k；极高 = 24k", mono("budget_tokens: 4096")))),
    ]),
]

FRAMES["web-settings-enabled-models"] = [
    ("A", "模型", "模型 · 白名单", "pattern 命中哪些模型、钉了哪一档，右边直接给匹配结果。", [
        ("白名单", table(
            ["pattern", "命中", "thinking 钉", "匹配结果"],
            [[mono("claude-*"), "4", "中", "opus-4.6 · sonnet-4.6 · haiku-4.5 · 3.7"],
             [mono("gpt-5*"), "2", "高", "gpt-5.1 · gpt-5.1-codex"],
             [mono("deepseek-*"), "1", "关", "deepseek-v4.1-flash"],
             [mono("kimi-k*"), "0", "—", "无命中"]])),
        ("语法", card(
            row("通配", "只支持末尾 *，不做正则", mono("claude-*")) +
            row("钉档", "命中的模型统一按这一档思考", seg(["关", "低", "中", "高"], 2)))),
    ]),
    ("B", "模型", "模型 · 失配诊断", "每条失配单独写原因，给「改」和「删」两个动作。", [
        ("2 条 pattern 没有命中", card(
            row("kimi-k*", "提供方列表里叫 kimi-k3，前缀对不上", btn("改成 kimi-k*") + " " + btn("删")) +
            row("gpt-4*", "这个提供方已下线 4 系", btn("改成 gpt-5*") + " " + btn("删")))),
        ("为什么不能合并成一句", card(
            row("每条原因不同", "改法也不同：一条改前缀，一条该删", tag("逐条", True)))),
    ]),
    ("C", "模型", "模型 · 单条 pattern", "钉档六段能切，切完预览里的「生效档」跟着变。", [
        ("pattern", card(
            row("表达式", "", mono("claude-*")) +
            row("钉档", "", seg(["关", "低", "中", "高", "极高", "最大"], 2)) +
            row("生效档", "preview：sonnet-4.6 会用「中」", tag("中", True)))),
        ("与其它条目的关系", card(
            row("被更宽的覆盖", mono("claude-*") + " 覆盖了 " + mono("*") + " 的档位", tag("后者胜", True)) +
            row("命中预览", "", mono("opus-4.6 / sonnet-4.6 / haiku-4.5 / 3.7")))),
    ]),
]

FRAMES["web-settings-plugins"] = [
    ("A", "插件", "插件", "已装列表：来源 / 版本 / 启用 / 更新；行尾菜单里有卸载确认。", [
        ("已装", card(
            row("pi-apply-patch", "内置 · 1.2.0 · 最新", sw(True) + " " + btn("更多")) +
            row("skills-market", "npm · 0.9.3 · 有更新", sw(True) + " " + btn("更新")) +
            row("legacy-lsp", "本地路径 · 0.4.1", sw(False) + " " + btn("更多")))),
        ("依赖提醒", card(
            row("legacy-lsp 被依赖", "关掉它会让「代码补全」这一项消失", tag("2 处依赖", True)))),
    ]),
    ("B", "插件", "插件 · 重载", "待生效的改动逐条列出，每一项都能单独撤掉。", [
        ("待生效（3）", card(
            row("启用 pi-apply-patch", "重载后生效", btn("撤掉")) +
            row("更新 skills-market 0.9.3 → 0.10.0", "重载后生效", btn("撤掉")) +
            row("禁用 legacy-lsp", "重载后生效", btn("撤掉")))),
        ("重载", card(
            row("会重载", "插件注册表、工具白名单", tag("立即", True)) +
            row("不会重载", "正在跑的会话不动，新会话才用新表", tag("安全", True)) +
            '<div class="crow"><span class="crow__title"></span><span class="crow__detail"></span><span class="crow__control">' + btn("重载 3 项", "btn--prom") + '</span></div>')),
    ]),
    ("C", "插件", "插件 · 详情", "权限 / 带来什么 / 依赖关系 / 兼容性，四段能切。", [
        ("skills-market", card(
            row("权限", "读 ~/.pi/skills、写索引缓存", tag("2 项")) +
            row("带来", "3 个工具 · 1 个设置分区", tag("工具")) +
            row("依赖", "无；被 legacy-lsp 依赖", tag("1 处", True)))),
        ("兼容性", card(
            row("与当前版本", "需要 pi ≥ 1.1.0", tag("兼容", True)) +
            row("与 Node", "需要 ≥ 20", tag("兼容", True)) +
            row("不兼容时", "整行标红，开关禁用，不静默失败", tag("显式", True)))),
    ]),
]

FRAMES["web-settings-mcp-exposure"] = [
    ("A", "MCP 服务器", "MCP · 曝光档位", "四档：模型怎么拿到、上下文开销、什么时候用。", [
        ("四档", card(
            row("不暴露", "模型看不到任何工具", tag("0 token")) +
            row("按需", "先给工具名，用到再取 schema", tag("~200 token", True)) +
            row("全量", "一次给全部 schema", tag("~4k token")) +
            row("仅本会话", "只在这一条会话里给", tag("临时")))),
        ("症状对照", table(
            ["你看到的", "该调哪一档"],
            [["模型不知道有这个工具", "按需 / 全量"],
             ["上下文被工具挤满", "不暴露 / 按需"],
             ["同一会话里时好时坏", "仅本会话"]])),
    ]),
    ("B", "MCP 服务器", "MCP · 逐 server 逐工具", "按服务器分组 / 按档位汇总，两个视角。", [
        ("视角", card(row("分组方式", "", seg(["按服务器", "按档位"], 0)))),
        ("filesystem", card(
            row("read_file", "调用 128 次", seg(["关", "按需", "全量"], 2)) +
            row("write_file", "调用 22 次", seg(["关", "按需", "全量"], 1)) +
            row("list_dir", "调用 9 次", seg(["关", "按需", "全量"], 1)))),
        ("github", card(
            row("search_repos", "调用 4 次", seg(["关", "按需", "全量"], 1)) +
            row("create_pr", "调用 0 次", seg(["关", "按需", "全量"], 0)))),
    ]),
    ("C", "MCP 服务器", "MCP · 诊断", "两类问题只解释不绕：工具表为空 / 策略头拒收。", [
        ("工具表为空", card(
            row("原因", "服务器连上了但没声明 tools", tag("不是网络问题", True)) +
            row("怎么办", "看服务器自己的日志；这里没有可点的修复", btn("复制诊断")))),
        ("策略头拒收", card(
            row("原因", "网关要求 X-Exposure 头，服务器没发", tag("网关侧", True)) +
            row("为什么不提供绕过开关", "绕过去等于把工具全量塞给模型，违背这一块的设计前提", tag("设计决定", True)))),
    ]),
]
