# 架构研究笔记

> 公司架构为什么这样设计：每条结论都写了来源，以及我们据此改了什么。
> 新的研究发现追加到这里，并写清楚改了哪个文件。

## 2026-11-18

### 1. 弱模型先写、强模型来审，结果不如强模型自己写
- 证据：
  - 12 个开源模型、96 种审查组合的测试。强模型审弱模型的稿子，结果平均比强模型单独做低约 3 分；两个模型差距越大，结果越差；成本是强模型单独做的约 2.8 倍。原因是审查者容易被草稿带偏：它自己原本答对、草稿答错的题目，最后只改对了 40%。（[arXiv 2610.15897](https://arxiv.org/html/2610.15897v1)）
  - 挑选者只能从已有的候选里挑，候选里没有好答案就挑不出来。（[arXiv 2605.14163](https://arxiv.org/html/2605.14163)）
  - 给评判模型先看一个分数或参考，它的判断会被拉向那个方向；加思维链或提醒它忽略都没用。（[arXiv 2608.25869](https://arxiv.org/abs/2608.25869)）
  - 如果已经有两份独立答案，让强模型二选一，比让它改其中一份更准，也更便宜。（[arXiv 2610.15897](https://arxiv.org/html/2610.15897v1)）
- 我们改了：
  - 设计由 Opus 从头写，员工只提供事实材料（`workers.json` 的 `in_house` 规则，以及 skill 的“谁做什么”表）。
  - 需要多个方案时，让便宜员工各自独立写，再挑最好的；不再让强模型修改弱模型的稿子。

### 2. 强模型主导、弱模型执行，效果好
- 证据：
  - Anthropic 的调研系统由 Opus 主导、Sonnet 子代理分头执行，在其内部评测上比 Opus 单独做高 90%。代价是用量约为普通对话的 15 倍，主要适合需要大范围搜集信息的任务。（[Anthropic 原文](https://www.anthropic.com/engineering/multi-agent-research-system)、[Simon Willison 摘录](https://simonwillison.net/2025/Jun/14/multi-agent-research-system/)）
  - Anthropic 的 advisor 工具：Sonnet 执行，关键节点请教 Opus。在一项代码评测上比 Sonnet 单独做高 2.7 个百分点，成本更低。这是 Anthropic 自己公布的数据，还没有独立复测。（[分析文章](https://blog.imseankim.com/claude-advisor-tool-executor-opus-sonnet-haiku-swe-bench-cost-2026/)）
- 我们改了：Opus 负责定方向，员工按详细的设计生产，Claude 负责验收。

### 3. 多智能体系统出问题，主要是任务说明不清和缺少验收，而不是模型太弱
- 证据：
  - 研究分析了 1642 次运行记录，把失败分成三类：约 44% 是系统设计或任务说明的问题，约 32% 是智能体之间配合不好，约 24% 是验收不到位。
  - 常见的具体失败：不知道什么时候该停、提前停下、没验收或验收不完整。
  - 只改流程设计、不换模型，成功率就能提高约 9%。（[MAST，arXiv 2503.13657](https://arxiv.org/pdf/2503.13657v3)）
- 我们改了：
  - 任务单模板增加“范围（做什么/不做什么）”“产出格式”“停止条件”和反例检查。
  - 派活脚本支持 `check:`：员工做完后，自动在沙盒里运行检查命令。

### 4. 按上下文拆分任务，不要按角色拆
- 证据：
  - Anthropic 的建议是按上下文拆，不按角色拆。规划、编码、测试、审查各交给不同的智能体时，它们花在协调上的用量比干活还多。功能代码和它的测试应该放在同一个任务里。
  - 多智能体通常要多用 3–10 倍的用量。能用单个智能体解决的，先用单个智能体。
  - 验收要具体：跑完整套测试，包括边界情况和反例，防止“跑了几个测试就宣布成功”。
  - （[Anthropic：什么时候该用多智能体](https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them)）
- 我们改了：skill 新增“怎么拆任务”一节。

### 5. 先用便宜的模型，检查不过再升级
- 证据：
  - FrugalGPT 先用便宜模型、不合格再换贵的，在其测试任务上能做到和 GPT-4 相当，成本最多降低 98%。
  - 理论上，“先按任务挑模型，不合格再升级”的组合，优于只挑一次或只靠逐级升级。
  - 前提是检查比生成便宜，否则反而亏。还要关注检查本身漏判、误判的比例。
  - （[FrugalGPT 等方法综述](https://www.llms.blog/posts/model-routing-and-cascades-in-production-comparing-routellm-frugalgpt-embedding-classifiers-and-verifier-cascades)、[路由与级联综述，arXiv 2603.04445](https://arxiv.org/html/2603.04445v1)）
- 我们改了：
  - 加了 `escalate: 1`：检查没通过时，自动换一个更强的员工重做，并把检查结果附在任务里。
  - 只在有命令可以自动检查时才启用，失败的那次会自动记成“不通过”。

### 6. 经验要写成自动检查，而不是越写越长的说明
- 证据：
  - 一项预先登记的实验显示，结构化的项目记忆（约定、任务、交接、决定）能让成功率比没有记忆高 57 个百分点。（[agent_memory_study](https://github.com/ahmadmhmdsy/agent_memory_study)）
  - ETH 的研究发现，泛泛的 AGENTS.md 文件平均让成本增加 20% 以上，却没有提高成功率；只有写明“模型猜不到的特殊约定”时才有用。（[arXiv 2602.11988](https://arxiv.org/abs/2602.11988)）
  - 写成文字的经验时间一长就会被模型忽略，重要的应该做成自动检查。（[Make It a Check](https://dev.to/vasyltretiakov/make-it-a-check-compounding-a-coding-agents-lessons-as-gates-not-claudemd-prose-3170)）
- 我们改了：
  - 每个项目放一份 `.ai-tasks/context.md`，只写猜不到的约定，派活时自动附在任务里。
  - 同一个错误出现两次，就把它写成 `check:` 检查命令。

## 2026-11-18 游戏 / 3D / 动画专题

### 7. 让模型“看到”自己的渲染结果，效果明显变好
- 证据：
  - Manim 动画代码生成：加入“渲染后再改”的循环（renderer-in-the-loop，最多 3 轮）后，画面相似度从 64.8% 提到 85.7%，能成功渲染的比例从 72% 提到 94%。（[arXiv 2604.18364](https://arxiv.org/html/2604.18364v1)）
  - GameDevBench（Godot 引擎，132 个任务）：给模型看编辑器截图或运行视频后，成功率稳定提高。例如 Claude Sonnet 4.5 从 33.3% 提到 47.7%。两种反馈一起给，比只给一种好不了多少。（[GameDevBench](https://www.emergentmind.com/papers/2602.11103)）
- 我们改了：新增 `ai-snap` 工具（`bin/snap.sh`），可以给网页或游戏截图、连拍几帧看画面有没有在动、用 Blender 渲染脚本、检测图片是不是空白。每个任务说明里都写了这个工具，要求员工交活前先看自己的画面；`check:` 里也可以用它做自动检查。

### 8. 游戏开发里，AI 最弱的是画面和场景，不是代码逻辑
- 证据：
  - GameDevBench：玩法逻辑类任务成功率 46.9%，2D 图形和动画类只有 31.6%，最好的组合也只做成 54.5%。
  - V-GameGym：多数模型写游戏代码能得 70 分以上，但按截图和视频评分基本都在 25 分以下。（[V-GameGym](https://arxiv.org/pdf/2509.20136)）
  - 同一项测试里，Gemini 3 Flash 的性价比最高，而且在 Google 自家的命令行里表现最好。
- 我们改了：
  - 拆出 `game_code`（玩法逻辑）和 `game_visual`（画面、场景）两个类别。`game_visual` 各员工的分数打得更低，高质量任务会交给更强的员工。
  - Gemini Flash 作为普通玩法代码的便宜首选。

### 9. 视觉评判会漏掉空间错误，要配合代码层面的检查
- 证据：
  - BlenderWorld 测了 13 个前沿模型，它们都很难根据看到的画面正确修改 3D 结构。最好的模型也只在 42% 的任务上满足全部要求。（[arXiv 2610.23986](https://arxiv.org/html/2610.23986)）
  - LL3M 用视觉模型来评判生成的 3D 模型，作者自己承认会漏掉细微的空间瑕疵。（[LL3M](https://github.com/threedle/ll3m)）
  - 修复 Manim 脚本时，整段重写比在坏脚本上反复打补丁效果好。（[ManimAgent](https://arxiv.org/html/2606.30296)）
- 我们改了：
  - skill 规定：截图检查只能确认“有没有画出来、有没有在动”，不能判断好不好看、位置对不对。最终画面由 Claude 亲自看，审美上的问题问用户。
  - 能写成代码检查的尽量写，比如物体数量、名称、位置范围。
  - 脚本坏了、修一次还不行，就整段重写。

### 10. Unity：用官方命令行和测试框架
- 证据：
  - Unity 已经把旧的 MCP 服务换成官方命令行（`unity test/build/mcp`），并出了 Claude Code 插件。在 Claude Code 中以 unity:* 系列 skill 提供。
  - 社区经验：
    - 用 Unity Test Framework 写测试，AI 才有东西可跑。
    - 不要手改 `.unity` 场景文件和 `.meta` 文件。
    - 一个任务只做一个系统。
  - （[unity-agent](https://github.com/m4bwav/unity-agent)、[AIGamer 指南](https://www.aigamer.gg/guides/unity-ai-mcp-claude-code)、[Codex 游戏开发流程](https://codex.danielvaughan.com/2026/04/27/codex-cli-game-development-unity-godot-mcp-agent-driven-workflows/)）
- 我们改了：
  - 员工负责写 C# 脚本和 EditMode 测试，Claude 用 unity 命令行运行这些测试。
  - 员工在沙盒里，碰不到 Unity 编辑器，所以场景和预制体的改动都由 Claude 通过编辑器来做。

## 暂不采用
- 学习型路由（RouteLLM 等）：需要大量带打分的历史数据。我们目前只有几十条记录，先用规则加公开榜单。等积累到几百条打分后再考虑。
- 专门的审查员工：Opus 能直接验收。研究也显示，强模型直接验收往往够用，额外加一道审查反而多花用量。
