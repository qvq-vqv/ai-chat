# 能力与支持边界（v4）

| 能力 | 状态 | 条件 |
|---|---|---|
| 派活到 agy / codebuddy / codex | 维护者 Mac 上日常使用 | macOS；员工 CLI 已安装并登录 |
| 实时额度读取 | agy（`/usage`）、Codex（本地会话记录中的限额）、CodeBuddy（按本地派活记录估算的每日软上限） | 读不到时显示 unknown，该池不会被选中 |
| 沙盒 | macOS `sandbox-exec`：写入只限工作目录 | Linux/Windows 不支持派活 |
| `sandbox: os`（codex 在自建沙盒中运行） | 已验证可编译 Xcode 项目 | 仍只限工作目录写入 |
| 席位分数 | 公开榜单 + 维护者少量实测 | 你的账号、模型和版本可能不同，用 `ai-route rate` 积累自己的评分 |
| 出图 / 视频 | agy 出图、CodeBuddy 视频（有水印、耗额度大）已试 | 视频每次派前问用户 |
| Unity / Blender | 员工写脚本和测试；场景改动由主管 AI 通过编辑器做 | 需要对应软件 |
| 主管 AI | Claude Code 最佳（技能自动加载，可用 Opus 子代理） | 其他 AI 可按 SKILL.md 手动操作 |
| `skills/ai-chat/`（v3 会话传话） | 实验，未在 v4 改动 | 见其自身说明 |

员工 CLI 的命令行参数、模型名和额度规则由各厂商决定，随时可能变化；变化后需要更新 `bin/dispatch.sh` 或 `workers.json`。

费用由你选择的账号决定。本项目不提供账号或额度。
