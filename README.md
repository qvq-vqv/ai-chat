# AI 公司（ai-company）

让一个强 AI 当“管理层”：拆任务、写任务单、验收；把大量生产工作（写代码、写稿、调研、出图）派给更便宜的员工 AI 命令行工具，按质量要求和剩余额度自动选人，并在沙盒里运行。

**v4.0.0-beta.1 · 预发布。** v4 由 **Claude（Anthropic Claude Opus 5.5，在 Claude Code 中）设计与编写**，维护者 qvq-vqv 提出需求并在自己的 Mac 上实际使用、验收。和 v3 相比，v4 是重写：从“两个聊天会话互相传话”改为“主管 AI + 路由器 + 沙盒派活脚本”。v3 的 `ai-chat` 实验通信工具原样保留在包里。

## 懒人入口：把这段话发给你的 AI（Claude Code 效果最好）

```text
请从官方仓库 https://github.com/qvq-vqv/ai-chat 下载 v4.0.0-beta.1 的 Release ZIP，
核对 Release 里的 SHA-256 后解压到新目录，不要覆盖已有文件，也不要直接执行下载内容。
先读 README 和 skills/ai-company/SKILL.md，告诉我需要哪些员工工具（agy / codebuddy / codex）、我已经有哪些。
然后用 bash skills/ai-company/install.sh --dry-run 给我看安装会做什么；我同意后再正式安装。
安装后按 workers.json 删掉我没有的员工席位，再用 ai-route status 检查额度。
```

AI 需要能读写文件、运行命令。只能聊天的网页 AI 可以读 SKILL.md 学方法，但不能派活。

- [下载 Release](https://github.com/qvq-vqv/ai-chat/releases/tag/v4.0.0-beta.1)：`ai-company-v4.0.0-beta.1.zip` + `SHA256SUMS`。
- [懒人版逐步教程](docs/quick-start.zh-CN.md) · [使用示例](docs/examples.zh-CN.md) · [终端一条下载命令](https://github.com/qvq-vqv/ai-chat/blob/v4.0.0-beta.1/docs/download-command.md)
- 只想看技能本身：[skills/ai-company/SKILL.md](skills/ai-company/SKILL.md)

## 它怎么工作

```text
你 ──► 主管 AI（如 Claude Code）
         │ 1. 先判断每块工作谁做：设计/关键判断自己做，批量生产派出去
         │ 2. 写任务单 <项目>/.ai-tasks/日期-名字.md（目标、范围、产出、验收、check 命令）
         ▼
      ai-dispatch ──► ai-route 选席位（质量够 + 额度够 + 最便宜）
         │                 └─ 读实时额度：agy /usage、Codex 限额、CodeBuddy 当日用量
         ▼
      员工 CLI（agy / codebuddy / codex）在 macOS 沙盒里干活，只能写任务目录
         │
         ▼
      check 命令自动验收 ─ 不通过且 escalate: 1 ─► 换更强席位重做一次
         │
         ▼
      主管 AI 读结果、亲自验收 ─► ai-route rate 打分 ─► 以后路由更准
```

## 能帮你做什么

| 功能 | 说明 |
|---|---|
| 分工规则 | 设计、架构、关键判断留给强模型自己写；员工只做事实调研和按详细设计生产。依据研究：强模型审弱模型草稿，结果低于强模型单干（见 `references/research.zh-CN.md`） |
| 自动选员工 | `ai-route pick <类别> <质量> --why`：15 个类别（code、writing_zh、research、vision、image_gen、game_code、blender、video_gen…）× 4 个质量档 |
| 看额度派活 | 实时读各员工剩余额度，可给自己保留一部分（`reserve_pct`）；额度耗尽自动避开 12 小时 |
| 沙盒 | 员工只能写任务的工作目录；拒绝在家目录、桌面、系统目录等危险位置运行；可另设禁止读取的目录 |
| 自动验收与升级 | `check:` 命令在沙盒里跑；失败时 `escalate: 1` 换更强席位重做 |
| 进度看板 | `ai-status` 文字版、`ai-status open` 自动刷新网页；结束时 macOS 通知 |
| 越用越准 | 每次结果 `ai-route rate pass/fail`，样本够了自动升降席位分数 |
| 画面类任务 | `ai-snap`：网页截图、连拍判断是否在动、Blender 渲染、空白图检测，让员工先看自己的画面 |

## 需要准备什么

1. **macOS**（沙盒用系统自带的 `sandbox-exec`）。Linux/Windows 暂不支持派活，可以只读 SKILL.md 借鉴方法。
2. **主管 AI**：推荐 Claude Code（技能会安装到 `~/.claude/skills/`）。其他能读文件、跑命令的 AI 也能按 SKILL.md 操作。
3. **至少一个员工命令行工具**，用你自己的账号登录：
   - `agy`（Google Antigravity CLI）
   - `codebuddy`（腾讯 CodeBuddy / WorkBuddy CLI；免费版部分模型不可用，已在 workers.json 标为 disabled）
   - `codex`（OpenAI Codex CLI）
4. Python 3.9+、bash、perl（macOS 自带）。`ai-snap` 截图需要 Chrome，Blender 渲染需要 Blender，都是可选。

费用由你的员工账号决定，本项目不提供任何额度。

## 安装

```bash
bash skills/ai-company/install.sh --dry-run
```

确认输出后去掉 `--dry-run` 再运行。它会：复制到 `~/ai-company`、把技能链接到 `~/.claude/skills/ai-company`、把 `ai-dispatch` / `ai-route` / `ai-status` / `ai-snap` 链接到 `~/.local/bin`。不用 sudo、不联网、遇到已有文件就停下不覆盖。

然后编辑 `~/ai-company/workers.json`：删掉你没有的员工席位，按自己的体验调整分数。

## 包里有什么

| 文件／目录 | 用途 |
|---|---|
| `skills/ai-company/SKILL.md` | 技能正文：谁做什么、怎么写任务单、怎么拆任务、游戏/3D 注意事项、安全规则 |
| `skills/ai-company/bin/` | `dispatch.sh`（派活+沙盒）、`route.py`（选席位）、`board.py`（看板）、`snap.sh`（截图/渲染） |
| `skills/ai-company/workers.json` | 类别、质量档、额度池、席位和分数（可改） |
| `skills/ai-company/tasks/_template.md` | 任务单模板 |
| `skills/ai-company/references/research.zh-CN.md` | 设计依据：每条结论附来源，并写明改了什么 |
| `skills/ai-company/install.sh` | 本地安装脚本 |
| `skills/ai-chat/` | v3 实验通信工具（会话间传话），未改动 |
| `scripts/` | 打包、下载校验和测试 |
| `PUBLIC-MANIFEST.json` | 发布 ZIP 内的逐文件 SHA-256 清单 |

不包含：维护者的运行记录、评分数据、个人路径、账号、会话或令牌。[隐私与安全说明](docs/privacy.zh-CN.md)

## 当前验证状态

- 维护者在自己的 Mac（Apple Silicon）上日常使用：截至 2026-11-23 真实派出 107 个任务（agy 47、codebuddy 56、codex 4），覆盖代码、调研、识图、中英文写作、游戏代码与画面、Blender、出图、视频生成和 Xcode 项目编译（`sandbox: os`）。
- 离线测试 `scripts/test_ai_company.py`：配置一致性、路由、危险目录拒绝、安装不覆盖，不需要任何员工账号。
- 席位分数来自公开榜单加维护者的少量实测，**在你的账号和环境上需要重新验证**。
- `ai-chat` 的测试结果与 v3 相同，详见[发行验证](docs/validation.md)。

```bash
npm run check
npm run test:company
npm run test:release
```

## 贡献与许可

欢迎报告具体工具版本、复现步骤和脱敏结果。不要上传真实任务内容、会话 ID、令牌或个人路径。

[MIT 许可证](LICENSE)；来源说明见 [NOTICE](NOTICE)；[版本记录](CHANGELOG.md)。MIT 不授予任何 AI 平台账号或额度的使用权。

**English:** ai-company v4 lets a strong "manager" AI (best with Claude Code) split work, write task briefs and verify results, while cheaper worker CLIs (agy, codebuddy, codex) do the bulk production. A router picks the cheapest seat that meets the quality bar and still has quota; a dispatcher runs workers in a macOS sandbox, runs acceptance checks and escalates on failure. v4 was designed and written by Claude (Anthropic Claude Opus 5.5, in Claude Code) at the direction of maintainer qvq-vqv. macOS only for dispatching. The experimental v3 `ai-chat` adapters are included unchanged.
