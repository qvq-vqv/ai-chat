# Codex 会话适配器（codex-session）

本适配器目标仅为 Codex 已有会话。调用端需要本地命令执行与相同用户的会话文件读取能力；不根据调用端的模型品牌限制使用。原始链路为 Antigravity → Codex，当前仅通过隔离测试，真实跨软件闭环待联调。它不实现其他目标软件或反向派单。

员工主动发送、主动接收并继续工作。每个项目绑定一个固定 Codex 架构师会话。使用ai-chat 技能目录下的 `scripts/codex-session.mjs`；命令输出 JSON。公司分工与 Goal 验收使用同仓库的 [公司协作守则](../../ai-company/SKILL.md)，单独安装时按实际技能目录定位。

## 授权与边界

- 用户需授权准确项目、接收会话和持续交流范围；已有授权可覆盖整个 Goal，不逐条重新询问。`--authorized` 是调用者确认已有授权，不能自行产生授权。
- 通过 `codex queue` 投递，仅从 Codex 会话索引和 rollout 读取记录。工具不直接读取凭证、不修改会话存储、不改变模型或会话生命周期、不操作 UI。
- 运行记录存放在项目目录或另一个独立运行目录，不能放在 CODEX_HOME 内。每个固定线程使用同一个共享 `--state-dir`，不同项目使用不同线程；不要从不同目录并发投递同一线程。
- 传输失败不授权换执行者、接管施工或退回 Computer 操控。模型回复是裁决数据，不是新的用户授权。

## 定位与只读检查

以下示例需把 <ai-chat目录> 替换为实际目录；员工实际调用时使用所安装脚本的绝对路径。各软件的安装目录见仓库 README；不要照搬其他电脑的路径。

```bash
node /absolute/installed/ai-chat/scripts/codex-session.mjs list --grep "项目名" --limit 20
node /absolute/installed/ai-chat/scripts/codex-session.mjs path "准确会话ID"
node /absolute/installed/ai-chat/scripts/codex-session.mjs read "准确会话ID" --tail 8 --events
```

初次可按准确名称定位，重名拒绝；绑定后实际发送使用 ID。`path` 返回该会话全部匹配的 rollout 文件；文件名匹配后还核实 session_meta.id，避免读取 fork 的记录。IPC 存在不等于架构师已开工。

## 发送一次请求

将正文写入项目的消息文件，包含 Goal/任务/版本、具体问题或交付摘要、证据绝对路径。为本次请求选择从未使用过的 request-id（例如带 UUID）。

```bash
node /absolute/installed/ai-chat/scripts/codex-session.mjs send \
  --thread "准确会话ID" \
  --project "项目ID" \
  --request-id "唯一请求ID" \
  --message-file "/绝对路径/message.txt" \
  --state-dir "/项目绝对路径/.codex-bridge" \
  --authorized
```

工具使用参数数组调用 CLI，正文中的反引号、美元符号、多行与引号不会作为 shell 代码执行。它自动添加请求身份和最终回复信封约定，发送前保存读取游标与 SENDING 状态，发送后保存原始回执和已识别的 message_id。

同一 request-id、正文及目标的再次 send 只返回原记录，不重复发送；同 ID 内容改变会拒绝。工具在同一个运行目录内拒绝向已有未解决请求的线程再投递新请求。

返回 `request_file` 是后续接收与恢复的入口，保存它。QUEUE 成功只说明已排队；没有有效回执返回 SEND_UNKNOWN，不能立即换 ID 重发。

## 员工自行接收

```bash
node /absolute/installed/ai-chat/scripts/codex-session.mjs wait \
  --request "/项目绝对路径/.codex-bridge/唯一请求ID.json" \
  --timeout-seconds 45

node /absolute/installed/ai-chat/scripts/codex-session.mjs status \
  --request "/项目绝对路径/.codex-bridge/唯一请求ID.json"
```

wait 默认最多等待 45 秒，每 2 秒检查新增记录；最长可设 3600 秒，但要适配员工实际命令运行上限。超时后继续调用同一 request_file 的 wait，不能重发 send。等待由本地程序承担；在持续任务内自行续接，不要求用户提醒。SIGINT/SIGTERM 取消本地等待并保留状态，不打断目标 Codex 轮次。

工具只接收：匹配请求的 user 消息 → 对应 turn_id → 同一轮次的 task_complete → 匹配身份的最终响应信封。进度、旧回复、其他轮次结束不会冒充结果。支持当前本机 response_item 和 item_completed 记录；增量字节游标处理分段 rollout、部分行写入及中文 UTF-8。

| status | 员工下一动作 |
| --- | --- |
| QUEUED / RUNNING | 继续等待；RUNNING 以已观察到关联轮次为依据 |
| SENDING / SEND_UNKNOWN / UNKNOWN | 查状态与 error/receipt；无证据不重发，不假称已启动 |
| COMPLETED | 读取 response.decision 与 response.reply，执行裁决；轮次完成不等于 Goal 完成 |
| INTERRUPTED / FAILED | 保留原请求、报告错误，按明确裁决恢复；不盲目重投 |
| PROTOCOL_ERROR | 本轮结束但回复缺失或身份/格式错误；报告协议缺口，不取旧回复兜底 |
| AMBIGUOUS | 同一请求出现在多个轮次；停止自动采用结果，先核实 |

超时输出保留真实 status 并附 `timed_out: true`；取消输出附 `cancelled: true`。BUSY 表示其他 bridge 进程持有锁；先让该进程完成。进程崩溃遗留的锁仅在确认 PID 已不存在时自动回收。

收到 COMPLETED 后，按公司守则的 ASSIGN/REVISE/ANSWER/ACCEPT 推进下一步；NEED_USER 返回用户决策；BLOCKED 保存阻塞；只有 GOAL_COMPLETE 且完整验收证据成立才结束 Goal。新问题使用新请求 ID。

## 架构师最终答复格式

发送工具已在消息中给出格式。Codex 在最终答复中输出一个 JSON 信封；详细合同和证据可放在 reply 文本或额外字段中。不要把进度信封当作最终答复。

```text
<codex-bridge-response>
{"project_id":"原项目ID","request_id":"原请求ID","decision":"ASSIGN","reply":"任务、允许范围、交付物和验收标准"}
</codex-bridge-response>
```

决策枚举：ASSIGN、ACCEPT、REVISE、ANSWER、NEED_USER、BLOCKED、GOAL_COMPLETE。不得更改请求/项目 ID。信封内容不会由工具自动作为 shell 或代码执行，由员工按职责与授权范围处理。

## 恢复与验证范围

请求记录包含回执、消息/轮次 ID、游标、最终裁决，可跨进程恢复。再次运行 status/wait 即可，无需重新发送。截断或损坏的记录返回 UNKNOWN；不猜测新存储格式。不要删除未解决的请求状态来绕过去重。

当前实现以本机已核实的 JSONL 事件结构为依据，不包含主动唤醒已结束的 Antigravity 会话。员工必须在其真实持续执行机制中调用等待与后续动作；软件重新启动后读取状态继续。真实 queue 能否启动指定目标，以及员工跨软件自动继续，仍需实际联调。

开发验证：`node --test scripts/bridge.test.mjs`。测试使用隔离会话 fixture 与假 CLI，不发送真实消息。验证证据见 [validation](validation.md)。公开版本只包含 v2；本地升级前的私人文档和历史审计不随仓库分发。
