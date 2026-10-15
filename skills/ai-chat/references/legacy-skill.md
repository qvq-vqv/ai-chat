---
name: codex-session-bridge
description: 以只读优先的方式桥接另一个本地 Codex 会话——列出/定位 Codex Desktop 的会话、读取其对话记录、并在获得用户明确授权后向该会话投递一条消息并读回回复。当用户提到「去 Codex 里找某个会话」「跟总架构师/另一个会话对话」「把结果发给 Codex 那边」「codex 会话」「agent 之间传话」时调用。区别于 UI 自动化：本技能全程不接管屏幕、不动鼠标。
---

# Codex 会话桥接（Codex Session Bridge）

把「和另一个本地 Codex 会话通信」变成**可复现的命令行操作**，而不是靠 UI 自动化去点界面。
全程不接管屏幕、不移动鼠标、不需要切换用户窗口。

## 为什么不需要切屏

Codex Desktop 的会话状态本来就落在磁盘上，而常驻 daemon 暴露了一个本地 socket：

- **会话索引**：`$CODEX_HOME/session_index.jsonl`（每行 `{id, thread_name, updated_at}`）
- **会话正文**：`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`（JSONL，逐条记录）
- **投递通道**：`codex queue --thread <id|名称> --message "<文本>"`，经 `$CODEX_HOME/ipc/ipc.sock` 交给 daemon
- `$CODEX_HOME` 默认是 `~/.codex`

于是「发消息」= 往 socket 写一条，「读回复」= 读文件。**窗口、鼠标、屏幕都不参与。**

> 对照：Codex 自带的 `computer-control` 技能走 `mcp__cua_repl` + 辅助功能 API，
> 而且会**接管用户真实会话**（横幅 "…is using your computer" / "Esc to cancel"）。
> 本技能刻意不走那条路。**有 API 就别去点界面。**

## 硬约束（不可绕过）

1. **发送前必须取得用户明确授权。** 每个项目/规划可能另有治理条款
   （例如本项目 design.md D19：「职责定义不等于授权自动向另一个会话发送消息」）。
   在用户点头之前，只允许执行本技能的**只读**部分。
2. **发送是有代价且单向的。** 每条消息会触发对方跑一整轮（消耗其额度）；
   回复落在**对方会话**里，不是当前对话，需要按第 5 步读回。
3. **默认只读。** 只读 `session_index.jsonl` 与 `sessions/**/rollout-*.jsonl`。
   **绝不读取 `$CODEX_HOME/auth.json`、`config.toml` 中的凭证，也不写入、不删除、
   不修改任何会话存储文件。**
4. **不改对方的会话状态。** 不 archive / delete / fork 对方会话，除非用户逐次明确要求。
5. **对方会话可能是活着的。** 投递前可观察 `$CODEX_HOME/thread-writer-locks/<id>.lock`；
   `queue` 本身对活跃会话是安全的，但要知道对方可能正在跑。

## 工作流

### 1. 找到 codex CLI

它通常**不在 PATH 上**，随 ChatGPT.app 分发：

```
/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex
```

`--version` 可验证。若换机器，用本技能脚本的 `path` 子命令查看解析结果。

### 2. 列出 / 定位会话

```
node scripts/codex-session.mjs list --grep "关键词" --limit 20
node scripts/codex-session.mjs path <会话id或名称>
```

拿到 `thread_id`（UUID）或**确切**的 `thread_name`，二者都能用于后续命令。

### 3. 读取会话（只读，随时可做）

```
node scripts/codex-session.mjs read <会话id或名称> --tail 6
node scripts/codex-session.mjs read <会话id或名称> --tail 3 --role assistant
```

输出 user / assistant 消息及其时间戳与字符数。这一步零副作用，可放心执行。

### 4. 发送消息（**先拿授权**）

把消息**写入文件**再用命令替换注入，避免 shell 转义破坏内容：

```bash
codex_bin="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
"$codex_bin" queue \
  --thread <会话id> \
  --message "$(cat /path/to/message.txt)"
```

成功时输出形如 `Queued message <msgId> for thread <threadId>.`，退出码 0。
把 `msgId` 记下来——它是这次投递的唯一凭据。

> 消息里包含反引号、`$`、括号、`#`、多行文本都没问题：`"$(cat file)"` 的结果
> 不会再被二次展开。**不要**直接把长文本拼在命令行里。

### 5. 等待并读回回复

对方需要时间（实测约 3 分钟：读取文件 → 独立复跑检查 → 出结论）。用有界轮询，
先记下投递时刻，然后只看该时刻**之后**的记录：

```bash
# 轮询：直到出现新的 assistant 消息或 task_complete
node scripts/codex-session.mjs read <会话id> --tail 5 --role assistant
```

判定对方**跑完**要看 `event_msg.type === "task_complete"`（或 `turn_aborted`），
不要只凭「有新消息」就下结论——中间会有大量 `reasoning` / `custom_tool_call`。

### 6. 汇报

把对方的**结论原文**转达给用户，并给出消息 id、会话 id、时间戳，便于追溯。
对方若把报告写进了项目文件，一并指出路径。

## 故障排查

| 现象 | 原因与处理 |
|---|---|
| `ERROR: stdin is not a terminal` | 用了需要 TTY 的子命令（如 `agents`）。改用 `queue` / `read` 路线。 |
| `queue` 报会话不存在 | 用 `list` 核对**确切** id 或名称；名称必须完全一致。 |
| 投递成功但迟迟无回复 | 对方可能没在跑（会话未打开）。查 `thread-writer-locks/<id>.lock` 与 rollout 的 mtime。 |
| 找不到 rollout 文件 | 会话可能被 archive 或迁移过；检查 `$CODEX_HOME/sessions.backup-*` 与 `archived_sessions/`。 |
| 脚本报 session index not found | `CODEX_HOME` 指错了；显式 `export CODEX_HOME=/path/to/.codex`。 |

## 与其他能力的边界

- **不要**用本技能替代 `computer-control` / computer-use 去操作**界面**；
  反过来，能走本技能时也不要退回 UI 自动化。
- 本技能**不**创建新会话、不换模型、不改配置、不装插件。
- 传输失败**不**授权接管对方的施工职责；如实报告阻塞。
