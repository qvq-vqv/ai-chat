# Antigravity 已有会话适配器

目标是本机 Antigravity 的准确对话 UUID；调用端需能执行本地命令、读取项目文件，并持有 Antigravity 官方提供的原生认证环境。主动发起方不需要另建一个同名目标适配器。

## 原生认证前提

agentapi 需要软件提供的 ANTIGRAVITY_LS_ADDRESS 与 ANTIGRAVITY_CSRF_TOKEN 环境。当前 Antigravity 员工可能由软件注入这些环境，但外部 Codex/WorkBuddy 进程不会自动拥有；必须现场 preflight 验证。不能通过提取登录或进程凭证、关闭 CSRF 来自动接入。缺少返回 MISSING_NATIVE_CONTEXT。

本机已定位用户指定测试会话，并进行只读原生检查：外部进程没有地址环境；针对观察到的服务监听地址，原生接口拒绝缺失 CSRF 的请求。因此尚不能从当前 Codex 进程投递，无真实消息发送。

## 实现与限制

发送使用本机 `agentapi send-message <recipient_id> <content>`。本机帮助仅提供 get-conversation-metadata、new-conversation 和 send-message；元数据不包含可靠的最终答复读取能力。本适配器不解密私有会话记录、不猜测内部网络接口、不切换窗口。

接收采用请求专属 `.response.json`：发送指令要求目标 AI 在本次工作完成后，以原子写入方式保存带项目、请求、目标身份及随机 request_token 的 final=true JSON。调用端自行等待这个唯一文件，不监测“谁工作”的开关。**这是协作式最终记录，不是 Antigravity 原生进程结束事件。** 必须用户接受此接收方式，并验证目标能写当前项目的指定回复文件；若用户要求纯原生会话日志接收，则此适配器不满足。

发送 CLI 返回仅标 SENT，不证明目标开始。发送超时或回执异常标 SEND_UNKNOWN，不重发。回复缺失继续等待；完整 JSON 身份不匹配报 PROTOCOL_ERROR，不取其他文件兜底。原会话中断可能无法自动发现，需报告等待超时及缺少原生失败事件，不能冒充失败或完成。

## 命令

用实际安装路径替换示例；agentapi 可通过 --cli 指定。本机优先定位 `~/.gemini/antigravity/bin/agentapi`；没有这个辅助入口时直接调用 Mac 应用随附 language_server 的 agentapi 子命令，不需额外创建软链接或脚本。

```bash
node /absolute/ai-chat/scripts/antigravity-session.mjs preflight --endpoint "准确对话UUID"
node /absolute/ai-chat/scripts/antigravity-session.mjs send \
  --project-root /absolute/project --state-dir /absolute/project/.ai-company/requests \
  --project project-id --request-id unique-id --endpoint "准确对话UUID" \
  --message-file /absolute/project/message.txt --authorized
node /absolute/ai-chat/scripts/antigravity-session.mjs wait --request /absolute/project/.ai-company/requests/unique-id.json --timeout-seconds 45
```

保存返回 request_file，超时续等同一个文件。全局目标绑定保存在 `~/.ai-chat/targets`，防止从不同项目/目录并发投递同一目标；已有项目归属冲突时拒绝，不自动重新绑定。目标文件目录须在已确认项目内，不能位于 CODEX_HOME 或通过软链接逃出项目。

当前完成本机命令、指定会话的只读接入检查及隔离测试；因缺原生认证环境，未向真实对话投递。测试会话已经定位；完整握手仍需在软件提供的认证环境内执行，并确认目标能写指定项目的回复文件。
