# 懒人版：第一次怎么用（v4）

目标：装好 ai-company，接上至少一个员工，成功派出第一个小任务。

## 第 1 步：下载

三选一：

- **让 AI 下载（推荐）**：把[首页的懒人提示词](../README.md)发给 Claude Code。
- **自己下载**：打开[本版 Release](https://github.com/qvq-vqv/ai-chat/releases/tag/v4.0.0-beta.1)，下载 `ai-company-v4.0.0-beta.1.zip` 和 `SHA256SUMS`，解压到新目录。
- **终端命令**：[复制本版下载命令](https://github.com/qvq-vqv/ai-chat/blob/v4.0.0-beta.1/docs/download-command.md)（需要 Python 3.9+，只下载、核对哈希、解压，不执行任何内容）。

喜欢 Git 也可以：

```bash
git clone --branch v4.0.0-beta.1 --depth 1 https://github.com/qvq-vqv/ai-chat.git ai-company-v4-source
```

## 第 2 步：安装

在解压目录里先看安装会做什么：

```bash
bash skills/ai-company/install.sh --dry-run
```

没问题就去掉 `--dry-run` 再运行。预期结果：

- `~/ai-company/`：技能和工具的家（可用 `--home 目录` 换位置）
- `~/.claude/skills/ai-company` → 上面的目录（Claude Code 自动识别技能）
- `~/.local/bin/ai-dispatch`、`ai-route`、`ai-status`、`ai-snap`

若终端找不到 `ai-route`，把 `~/.local/bin` 加进 PATH（让 AI 帮你改 shell 配置，改前先备份）。

## 第 3 步：接上员工

员工是你自己登录的命令行工具，至少要有一个：

| 员工 | 命令 | 备注 |
|---|---|---|
| Google Antigravity | `agy` | Gemini 额度较多，Claude/GPT 组额度小 |
| 腾讯 CodeBuddy / WorkBuddy | `codebuddy` | 免费版部分模型不可用（workers.json 里已标 disabled） |
| OpenAI Codex | `codex` | 代码最强之一，额度通常较紧 |

安装和登录由你自己完成，不要把密码或令牌发给 AI。然后编辑 `~/ai-company/workers.json`，删掉你没有的席位（`seats` 里的条目）。

检查：

```bash
ai-route status
```

```bash
ai-route pick code normal --why
```

第一条显示每个额度池剩余多少（unknown = 读不到，通常是没装或没登录）；第二条显示选了谁、为什么。

## 第 4 步：派第一个任务

在 Claude Code 里对 AI 说：

```text
用 ai-company 派一个小任务给员工试试：在当前项目写一个 hello 脚本和它的测试，check 用测试命令。
派完告诉我任务 ID，我用 ai-status open 看进度。
```

AI 会在 `<项目>/.ai-tasks/` 写任务单、后台运行 `ai-dispatch`、读结果并亲自验收，再用 `ai-route rate` 打分。

## 常见卡点

| 看到什么 | 怎么办 |
|---|---|
| `refusing unsafe workdir` | 工作目录不能是家目录、桌面、文稿、下载或系统目录；换到具体项目文件夹 |
| `no worker fits` | 额度不够或质量档太高：降一档、等额度重置，或让主管 AI 自己做 |
| 退出码 4（in-house） | 这是设计/关键判断类工作，按规则由主管 AI 自己做 |
| 退出码 5 | `check:` 仍不通过；看 `.ai-tasks/runs/<任务>.result.md` 和 raw log |
| xcodebuild 等在沙盒里报错 | 任务单加 `sandbox: os`（codex 员工） |
| 员工的 MCP 服务起不来 | 调整 `bin/dispatch.sh` 的沙盒规则，不要关掉沙盒 |

[能力边界](support.zh-CN.md) · [使用示例](examples.zh-CN.md) · [隐私说明](privacy.zh-CN.md)
