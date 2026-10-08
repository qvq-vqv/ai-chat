# AI传话 · ai-chat

**当前仅支持 Antigravity → Codex：Antigravity 主动发送请求，并主动读回 Codex 的最终回复。**

其他软件适配、Codex 主动向 Antigravity 派单、员工之间互联均未提供。当前版本是 **v2.0.0-alpha.1 实验预发布**：本地功能测试已通过，真实跨软件闭环尚待联调，不应视为已验证的无人值守产品。

## 两个入口

| 内容 | 作用 |
| --- | --- |
| [AI传话技能](skills/ai-chat/SKILL.md) | 实际发送、等待、接收、请求去重与恢复 |
| [公司协作守则](skills/ai-company-session-collaboration/SKILL.md) | Codex 负责规划与验收，Antigravity 负责施工和主动推进 |

守则不会自动安装通信能力，也不会自行唤醒已结束的员工会话。

## 原理

Antigravity 调用 Node 脚本 → 脚本运行本机 `codex queue --thread ... --message ...` → 指定 Codex 会话处理请求 → 脚本增量读取本机会话 JSONL → 根据请求 ID、轮次 ID 和完成事件读回最终答复。

发送走 Codex 的 CLI 后台入口，接收走会话记录，不操作窗口。依赖的 `queue` 和本地存储格式具有版本兼容风险；本地检查基线为 macOS、Codex CLI `0.162.0-alpha.2`、Node `25.8.1`。

## 前提

- Node.js 22 或更高，无第三方 npm 依赖。
- 本机已登录的 Codex CLI，且 `codex queue --help` 可用。不是所有发行版都包含该命令。
- 可读取相同用户的 `CODEX_HOME/session_index.jsonl` 和 `sessions/`。
- Antigravity 能执行本地命令，并在实际持续任务中等待和续接。
- 用户已授权目标项目、固定 Codex 会话与交流范围。

## 安装

下载仓库后，将 `skills/ai-chat` 安装到 Antigravity 实际使用的技能目录；常见入口为 `~/.gemini/antigravity/skills/ai-chat`。若目录已存在，先备份并检查，避免覆盖自己的版本。

Codex 架构师使用 `skills/ai-company-session-collaboration`，可安装到 `~/.codex/skills/ai-company-session-collaboration`。让双方明确读取对应 SKILL.md；客户端技能刷新方式以实际软件行为为准。单独复制技能后，按真实安装位置定位另一个技能，不依赖仓库内相对链接。

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

对双方说明：采用公司协作守则；Codex 是总架构师，Antigravity 是员工；给出项目路径、Goal、验收标准、固定 Codex 会话 ID、允许自动推进的范围，以及必须询问用户的事项。授权内持续交流到完整 Goal 验收完成或需要用户决策。

首次先测试一个只读小任务，确认真实发送、回复、Antigravity 自行读回及下一步均成功，再扩大施工范围。

## 验证与边界

```bash
npm run check
npm test
```

17 项隔离测试通过，覆盖请求关联、进度过滤、分段记录、双项目结果隔离、去重、超时续接、失败/中断、UTF-8 部分写入及锁。测试使用假 CLI，不发送真实消息；[验证记录](skills/ai-chat/references/validation.md)。GitHub CI 配置针对 Node 22/24，结果以 Actions 实际运行为准。

- `--authorized` 只是调用者确认已有授权，不提供认证或访问隔离。
- CLI 的实际执行权限由 Codex 自身配置控制。
- 本工具不直接读取凭证或改写 Codex 会话存储；队列调用由 Codex 自己管理记录。
- 项目运行状态可能包含请求结果和本机路径，请勿提交或分享；gitignore 已忽略常用状态目录。
- 回复内容不会自动作为代码执行，由员工按原有权限处理。

## 来源与许可

最初的桥接思路及只读技能由项目发起者使用 DeepSeek 制作，v2 请求关联、等待与恢复实现及协作守则由 Codex 协助开发。此公开包不包含私人会话、原始历史审计或原版脚本。

尚未指定开源许可证。仓库公开可供查看；公开不等于授予任意再分发或商业使用许可。后续由维护者选择许可证。

---

**English:** Experimental **Antigravity → Codex only** request/reply bridge. Antigravity initiates requests and pulls matching final replies. No other app adapters or reverse dispatch are included. Local fixture tests pass; real cross-app end-to-end operation remains unverified. Node 22+, a compatible signed-in Codex CLI with `queue`, and same-user local rollout access are required. No open-source license has been selected.
