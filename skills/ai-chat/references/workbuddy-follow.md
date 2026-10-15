# WorkBuddy 原生追加接收（实验）

用于向准确的已有活跃桌面对话派单，使用该 worker 的 sessions/live 检查与 sessions/:id/reply 接口。与 ACP 共用 workbuddy-session 目标锁和原生完成记录恢复，不运行 session/load、不抢占桌面写入权、不创建 CLI 对话、不切前台。失活 worker 仍无法自动唤醒。

认证按 [官方 HTTP API 文档](https://www.codebuddy.ai/docs/cli/http-api) 使用本地网关密码的 Bearer 头。reply 路由另由已安装 WorkBuddy 5.7.6 的 replySession 实现确认，不应声称该路由有公开稳定承诺。模型 API Key、OAuth 账号令牌与此密码不同，不能混用。密码可能允许其他本地 API 能力，因此本适配只向准确 worker 的 live/reply 两个路径发送，拒绝重定向，不保存密码或打印原生响应错误正文。

调用前由用户明确授权提供本地网关凭据，运行时通过 AI_CHAT_WORKBUDDY_GATEWAY_PASSWORD 注入。不要自动读取账号存储或 gateway.password，不修改认证设置；401/403 立即停止。默认缺失凭据返回 NEED_GATEWAY_AUTH，不尝试猜测、改用其他认证或 ACP 接管。

```bash
node "/absolute/ai-chat/scripts/workbuddy-follow.mjs" preflight --endpoint "EXACT_UUID"
node "/absolute/ai-chat/scripts/workbuddy-follow.mjs" send --project-root "/absolute/project" --state-dir "/absolute/project/.ai-company/requests" --project "PROJECT" --request-id "UNIQUE" --endpoint "EXACT_UUID" --message-file "/absolute/project/message.txt" --authorized
node "/absolute/ai-chat/scripts/workbuddy-follow.mjs" wait --request "/absolute/project/.ai-company/requests/UNIQUE.json" --timeout-seconds 45
```

投递回执 delivered 不等于最终回复。必须 wait，核对准确 transcript 内 status=completed 的 assistant 及项目、请求、目标、nonce 完全匹配的最终信封；发送超时保留 SEND_UNKNOWN，不重发。当前隔离测试通过；本机指定测试绑定已完成 Codex 主动投递与匹配原生最终答复，凭据由用户明确授权的准确 worker 临时环境注入。其他绑定仍需现场验证。回复完成后入口可能被回收，仅证明活跃 worker 下的收发，不证明空闲/重启后自动唤醒。公共脚本不自动提取进程凭据，现场私有诊断脚本不随包分发。
