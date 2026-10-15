# Antigravity 已有会话适配器

目标是本机 Antigravity 的准确对话 UUID；调用端需能执行本地命令、读取项目文件，并持有 Antigravity 官方提供的原生认证环境。主动发起方不需要另建一个同名目标适配器。

## 原生认证前提

agentapi 需要软件提供的 ANTIGRAVITY_LS_ADDRESS 与 ANTIGRAVITY_CSRF_TOKEN 环境。当前 Antigravity 员工可能由软件注入这些环境，但外部 Codex/WorkBuddy 进程不会自动拥有；必须现场 preflight 验证。不能通过提取登录或进程凭证、关闭 CSRF 来自动接入。缺少返回 MISSING_NATIVE_CONTEXT。

本机已定位用户指定测试会话，并进行只读原生检查：外部进程没有地址环境；针对观察到的服务监听地址，原生接口拒绝缺失 CSRF 的请求。因此直接原生调用仍不可用；外部调用改走下文由宿主管理的 Sidecar。

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

当前完成本机命令、指定会话的只读接入检查及隔离测试；直接模式依赖原生认证环境；外部 Sidecar 模式的实际验证见下文，每个新的绑定仍需握手。

## 外部调用：官方 Sidecar

Antigravity 官方支持在 `~/.gemini/config/sidecars/<id>/sidecar.json` 注册后台进程，并在 `~/.gemini/config/config.json` 的 sidecars 配置中启用。宿主为进程提供原生 agentapi 环境，无需向 Codex 导出账号凭证。来源：[官方 Sidecars 文档](https://www.antigravity.google/docs/sidecars)。

本包 `antigravity-sidecar.mjs` 提供绑定到单个项目、单个会话且有到期时间的后台投递。绑定 JSON 包含 schema_version=1、authorized=true、project_root、project_id、endpoint_id、项目内 inbox 目录和 expires_at。配置前沿用用户的准确通信授权；保存原配置并只增改自己的 sidecar 项。sidecar.json 的 command 指向实际 Node，args 为脚本绝对路径、serve、--binding、绑定文件绝对路径。restart_policy 使用 never，不能在投递不确定时自动重试。

外部调用使用该脚本的 preflight/send/status/wait；send 额外传 `--binding FILE`，其余参数与原生适配相同。preflight 必须观察到该准确绑定的新鲜 READY 心跳。外部进程写请求队列，宿主 Sidecar 通过 agentapi 投递到软件内；这不是控制“该谁工作”的开关。回复仍采用上文的请求专属最终文件。claim/receipt 保留以防崩溃重发；心跳不证明目标 AI 已接收或完成。状态文件继续使用 antigravity-session 标识，和直接原生投递共享目标锁。

此路径在一个用户指定测试会话中完成了 Codex 主动发送、Antigravity 写回最终记录及身份核对。结论仅适用于该绑定；发布包、其他电脑和项目仍需各自握手。停机在 inbox 创建 STOP 或禁用自己的 sidecar；到期自动退出。
