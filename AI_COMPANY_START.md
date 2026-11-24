# AI 公司一键启动（v4）

把本文件交给你的主管 AI（推荐 Claude Code），说“按 ai-company 帮我安装并检查员工”。

1. 读 [skills/ai-company/SKILL.md](skills/ai-company/SKILL.md)：谁做什么、怎么写任务单、怎么派活和验收。
2. 先运行 `bash skills/ai-company/install.sh --dry-run`，把将要做的事给用户看；用户同意后去掉 `--dry-run`。
3. 检查用户已登录哪些员工 CLI（`agy`、`codebuddy`、`codex`），在 `~/ai-company/workers.json` 中删掉没有的席位。
4. 运行 `ai-route status` 和 `ai-route pick code normal --why`，确认能选出员工。
5. 第一次派一个小而可检查的任务（带 `check:`），验收通过后再放手用。

不要替用户登录账号、输入令牌或安装员工工具；需要安装时先列清单问用户。

旧版（v3）通信工具在 [skills/ai-chat/](skills/ai-chat/SKILL.md)，仍为实验状态。
