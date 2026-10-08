# AI 公司与 AI传话

一个用户入口：[AI 公司一键启动](AI_COMPANY_START.md)。AI 预填项目、目标、角色和实际软件会话；用户确认后，发现通信适配器，验证发送与主动读回，再持续执行和验收。默认优先已有软件对话。

**v3.0.0-alpha.1 实验预发布：公司角色不再绑定模型品牌，通信按软件能力选择适配器。内置连接实现包含 Codex 已有会话、Antigravity 原生认证环境下投递+协作式回复文件，以及 WorkBuddy 官方本地助理通道（需 OAuth，不能指定任意桌面对话 ID）。Claude/Grok/GLM 等可通过符合契约的已安装技能扩展，但本包未内置其软件会话连接。静态路由和隔离测试不能证明真实软件已接通。**

v2.0.0-alpha.1 保持原 Antigravity → Codex 范围。v3 增加模块与实验适配，不代表新增方向已经真实连通。

## 用户怎么用

一键启动入口 9 行，ai-company 路由入口 24 行。角色职责、启动向导、循环、合同及恢复按需读取；链接负责定位，本机软链接共享同一份文件，公开包不依赖个人软链接。主动员工不需要自己的接收目标适配器，只需实测运行目标适配器及等待读回的能力。

把 AI_COMPANY_START.md 交给当前项目 AI，说“启动 AI 公司，先帮我预填配置”。先检查已有信息，只问缺失项；下一轮确认整份配置与授权范围。其他技术字段由 AI 准备。已有绑定直接恢复，不重新初始化。

一份文件是用户入口，运行依赖完整技能包。软链接可共享同机文件，不能把脚本自动带到另一台电脑。

## 包含什么

| 入口 | 职责 |
| --- | --- |
| [ai-company](skills/ai-company/SKILL.md) | 启动向导、角色绑定、任务合同、独立验收与恢复 |
| [ai-chat](skills/ai-chat/SKILL.md) | 发现/筛选适配器、验证实际收发及通信恢复 |
| [Codex 适配器](skills/ai-chat/references/codex-session.md) | 现有 Codex CLI queue 与本机会话记录接收 |
| [Antigravity 适配器](skills/ai-chat/references/antigravity-session.md) | 需原生认证环境的已有会话投递 + 请求专属回复文件 |
| [WorkBuddy 适配器](skills/ai-chat/references/workbuddy-localassistant.md) | 官方本地助理 OpenAPI + 最终回复信封，需 OAuth |
| ai-company-session-collaboration | 保留旧入口，转到 ai-company，不丢弃原绑定 |

## 适配能力与局限

模型与软件分开配置：Claude Code、Claude 网页、Claude API 不是同一种入口。已有软件模式不会自动转为 API；API 可能单独计费，需要明确授权。本项目不是常驻调度服务，技能不能唤醒结束的聊天。

路由器只读检查指定 registry：

```bash
node skills/ai-chat/scripts/adapter-router.mjs list
node skills/ai-chat/scripts/adapter-router.mjs plan --endpoint /absolute/project/endpoint.json --registry /absolute/project/.ai-company/adapters
```

CANDIDATE 表示资源与声明满足静态条件；需核实实际实现和本项目真实握手后才可运行。没有适配器返回 UNSUPPORTED，不猜测接口、不自动执行外部技能。第三方注册要求见 [适配契约](skills/ai-chat/references/adapter-contract.md)。

## 内置 Codex 适配器原理

具备本地命令和会话文件访问能力的员工调用 Node 脚本 → 脚本运行本机 `codex queue --thread ... --message ...` → 指定 Codex 会话处理请求 → 脚本增量读取本机会话 JSONL → 根据请求 ID、轮次 ID 和完成事件读回最终答复。

发送走 Codex 的 CLI 后台入口，接收走会话记录，不操作窗口。依赖的 `queue` 和本地存储格式具有版本兼容风险；本地检查基线为 macOS、Codex CLI `0.162.0-alpha.2`、Node `25.8.1`。

## 内置 Codex 适配器的前提

- Node.js 22 或更高，无第三方 npm 依赖。
- 本机已登录的 Codex CLI，且 `codex queue --help` 可用。不是所有发行版都包含该命令。
- 可读取相同用户的 `CODEX_HOME/session_index.jsonl` 和 `sessions/`。
- Antigravity 能执行本地命令，并在实际持续任务中等待和续接。
- 用户已授权目标项目、固定 Codex 会话与交流范围。

## 安装

从 [v3 预发布](https://github.com/qvq-vqv/ai-chat/releases/tag/v3.0.0-alpha.1) 下载 `ai-company-v3.0.0-alpha.1.zip` 并完整解压，保留目录结构。把解压后的 `AI_COMPANY_START.md` 交给 AI，让它先检查依赖与技能目录，再安装完整的 `ai-company` 和 `ai-chat`；不要只复制入口文件。也可使用下方的手工安装方式。

下载仓库后，将 `skills/ai-chat` 安装到 Antigravity 实际使用的技能目录；常见入口为 `~/.gemini/antigravity/skills/ai-chat`。若目录已存在，先备份并检查，避免覆盖自己的版本。

项目角色使用 `skills/ai-company`，可安装到当前软件的技能目录（Codex 例：`~/.codex/skills/ai-company`）。需要保留旧入口时也安装 `skills/ai-company-session-collaboration`。让双方明确读取对应 SKILL.md；客户端技能刷新方式以实际软件行为为准。单独复制技能后，按真实安装位置定位另一个技能，不依赖仓库内相对链接。

## 快速使用

在仓库根目录执行：

```bash
node skills/ai-chat/scripts/codex-session.mjs list --grep "项目名"
node skills/ai-chat/scripts/codex-session.mjs path "准确会话ID"
```

将问题或交付说明保存为项目的 `message.txt`。以下占位值需替换为真实值：

```bash
node skills/ai-chat/scripts/codex-session.mjs send \
  --thread "准确会话ID" \
  --project "project-id" \
  --request-id "unique-request-id" \
  --message-file "/absolute/project/message.txt" \
  --state-dir "/absolute/project/.codex-bridge" \
  --authorized
```

保存返回的 `request_file`，由 Antigravity 自行等待：

```bash
node skills/ai-chat/scripts/codex-session.mjs wait \
  --request "/absolute/project/.codex-bridge/unique-request-id.json" \
  --timeout-seconds 45
```

超时继续等待同一 request_file，不要换请求 ID 重发。COMPLETED 后读取 `response.decision` 和 `response.reply`。完整状态说明见 [技能文档](skills/ai-chat/SKILL.md)。

CLI 位置不匹配时，用 `--cli /absolute/path/to/codex` 指定；需要自定义数据目录时，用 `--codex-home /absolute/path`。运行状态必须保存在 CODEX_HOME 外，同一个目标线程共用同一个 state-dir。

## 项目启动

使用一键启动入口，不要求用户分别给两端填写手工模板。两个角色的软件、会话、权限及目标需用户确认；首轮真实握手同时传达架构师角色与合同请求。架构师无法访问本机路径时提供必要正文，不能把路径当成证据交付。

## 验证与边界

```bash
npm run check
npm test
```

38 项隔离测试通过（原桥接 17 项 + 路由 9 项 + 协作式适配 12 项），覆盖请求关联、进度过滤、分段记录、双项目结果隔离、去重、超时续接、失败/中断、UTF-8 部分写入及锁。测试使用假 CLI，不发送真实消息；[验证记录](skills/ai-chat/references/validation.md)。v3 源码已通过 [GitHub CI 的 Node 22/24 矩阵](https://github.com/qvq-vqv/ai-chat/actions/runs/37768325903)。CI 仍使用隔离测试，不证明真实软件闭环。

- `--authorized` 只是调用者确认已有授权，不提供认证或访问隔离。
- CLI 的实际执行权限由 Codex 自身配置控制。
- 本工具不直接读取凭证或改写 Codex 会话存储；队列调用由 Codex 自己管理记录。
- 项目运行状态可能包含请求结果和本机路径，请勿提交或分享；gitignore 已忽略常用状态目录。
- 回复内容不会自动作为代码执行，由员工按原有权限处理。

## 来源与许可

最初的桥接思路及只读技能由项目发起者使用 DeepSeek 制作，v2 请求关联、等待与恢复实现及协作守则由 Codex 协助开发。此公开包不包含私人会话、原始历史审计或原版脚本。

尚未指定开源许可证。仓库公开可供查看；公开不等于授予任意再分发或商业使用许可。后续由维护者选择许可证。

---

**English:** Experimental capability-based AI company onboarding and chat adapter routing. Existing software conversations are preferred. Bundled targets: Codex existing sessions, Antigravity native sends with cooperative reply files, and WorkBuddy official local-assistant channel with OAuth. The last two use cooperative final records, not native turn-completion events. WorkBuddy arbitrary desktop chat IDs are unsupported. Other applications require installed, verified adapters. Model names do not identify software interfaces. Static routing is not live connectivity. Local fixture tests pass; real cross-app operation remains subject to live handshake. No license selected.
