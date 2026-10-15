# AI 公司与 AI 传话

让项目 AI 帮你规划工作，再与另一个 AI 分工执行、交付和验收，减少人工复制消息和反复催“继续”。

**v3.1.0-beta.1 · 实验预发布。** 当前主要协作方式是一个固定总架构师配一个主动员工。它是一套技能、通信工具和工作规则，需要能操作本地文件/命令的 AI 软件；新项目完整现场验收、多岗位自动调度及无人值守运行尚未完成。

## 懒人入口：把这段话发给你的项目 AI

```text
请从官方仓库 https://github.com/qvq-vqv/ai-chat 下载 v3.1.0-beta.1 完整技能包。
先阅读 README 和 docs/quick-start.zh-CN.md，检查我的软件与依赖是否支持。
只下载到新目录，核对 Release 的 SHA-256；不要覆盖已有技能或项目，也不要直接执行下载内容。
然后读取 AI_COMPANY_START.md，预填项目目标、验收标准、阶段、岗位、工作流程、共享支撑和输出要求。
只集中问我需要决定的关键事项；确认实际软件会话、通信能力和授权后，再启动协作。
```

AI 需要能联网下载、读取文件并执行本地命令。普通网页聊天若没有这些工具，不能因此直接当执行员工。

- [下载完整技能包](https://github.com/qvq-vqv/ai-chat/releases/tag/v3.1.0-beta.1)：选择 `ai-company-v3.1.0-beta.1.zip`。
- [懒人版逐步教程](docs/quick-start.zh-CN.md)：从下载到第一次配置，含预期结果和常见卡点。
- [终端一条下载命令](https://github.com/qvq-vqv/ai-chat/blob/v3.1.0-beta.1/docs/download-command.md)：固定版本、先校验再解压，只下载，不改全局配置或启动员工。
- [新项目／已有项目／恢复提示词](docs/examples.zh-CN.md)。

## 能帮你做什么

| 工作 | 具体结果 |
|---|---|
| 从想法开始 | AI预填项目蓝图、阶段和第一份有界任务，用户决定关键取舍 |
| 按业务规划 | 推导必要职责、交接产物、共享支撑与输出格式，先用最小团队 |
| AI协作 | 员工主动请求任务、执行并提交，架构师检查证据后裁决 |
| 恢复与收尾 | 保存请求、版本和未决事项，中断续查原请求，避免盲目重发 |
| 结构检查 | 可选只读合同检查器；结果不代替真正验收 |

## 需要准备什么

1. 能读写项目文件、运行命令并持续等待的AI客户端。下载后让AI先检查能力。
2. 运行通信/检查工具需要 **Node.js 22或以上**。终端下载方案另外需要Python 3.9或以上；缺少时用手动下载或让AI指导。
3. 为架构师和员工选定实际软件及准确会话，使用自己的合法账号与额度。
4. 所选通信方式必须在你的电脑上通过检查与实际握手。软件安装了、模型名称相同，都不代表已接通。

Codex入口依赖本机 `codex queue` 和会话记录能力，并非每个版本都提供。Antigravity外部投递需官方宿主管理的Sidecar；通常不是解压后就自动可用。[支持情况与限制](docs/support.zh-CN.md)

## 包里有什么

| 文件／目录 | 用途 |
|---|---|
| `AI_COMPANY_START.md` | 给项目AI读取的启动入口，需保留完整包 |
| `skills/ai-company/` | 角色、项目启动、合同、独立验收和恢复规则 |
| `skills/ai-chat/` | 按实际软件选择通信方式的工具及测试 |
| `skills/ai-company-session-collaboration/` | 旧入口兼容；新用户选“AI公司一键启动” |
| `scripts/` | 公开打包、下载校验及隔离测试工具 |
| `PUBLIC-MANIFEST.json` | 发布ZIP内的逐文件SHA-256清单 |

本包不包含Studio、私人讨论、个人配置、真实会话记录或运行绑定。清单是文件身份核对，不是安全认证或数字签名。[隐私与安全说明](docs/privacy.zh-CN.md)

## 当前验证状态

2026-10-15本地重跑原工具测试：**181项，141通过、40失败，无跳过**。40项都在既有实验resident测试中；本版本没有修复或启用这条暂停路线。公司组65项已包含在上述总数且无失败。发行工具另有独立隔离测试，见[发行验证](docs/validation.md)。

开发者运行：

```bash
npm run check
npm test
python3 -m unittest discover -s scripts -p 'test_*.py' -v
```

`npm test`保留完整失败语义，当前会因上述实验测试返回非零，CI也不会伪装成全绿。真实软件通信仅在开发者指定环境做过有界试点；不能为其他电脑继承，也不等于从零项目、连续主动协作或生产监督已验收。

## 贡献与许可

欢迎报告具体软件版本、复现步骤及脱敏后的结果。不要上传真实消息、会话ID、令牌、个人路径或含这些内容的日志。

本项目以[MIT许可证](LICENSE)发布；来源说明见[NOTICE](NOTICE)。MIT不授予任何AI平台账号、模型额度或第三方服务的使用权限，软件与账号仍按其自身规则使用。[版本记录](CHANGELOG.md)

**English:** Experimental project onboarding, role-based AI collaboration and existing-session chat adapters. Start with the Chinese quick-start guide. One architect plus one active worker is the current baseline. Live connectivity depends on your software and authorization; multi-worker scheduling and unattended production are not implemented. Known experimental test failures remain visible.
