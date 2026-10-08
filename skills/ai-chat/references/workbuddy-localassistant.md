# WorkBuddy 本地助理适配器

使用 [WorkBuddy 官方 OpenAPI](https://open.workbuddy.cn/docs/openapi) 的本地助理在线检查、投递和增量消息历史。它连接本机软件的助理通道，不创建模型推理 API 会话。

**此接口不接受任意 WorkBuddy 桌面对话 ID。** 它面向已授权账号的 local-assistant 通道；注册 mode=local-assistant，endpoint/session_id 固定为 local-assistant。不能注册为 existing-session，也不能把该通道默认当成用户选中的某个项目聊天。启动表单必须说明此差异，用户选择并确认该助理专用于当前项目后才使用。

## 授权与接收

需要官方开放平台 OAuth 授权的读取和调用本地助理权限，令牌从当前进程环境 WORKBUDDY_ACCESS_TOKEN 取得。已登录桌面软件不等于具备此授权；不从软件存储提取登录凭证，不自动注册第三方应用或扩展权限。缺授权返回 MISSING_AUTH，不能声称已连通。

POST 获得 message_id 后，GET 使用该 ID 增量读取历史。只接收当前项目/request_id/request_token 的单个 ai-chat-response JSON 信封，且 final=true。**最终检测依据目标 AI 的显式协议记录，不是本地助理 API 暴露的原生轮次结束事件。** 历史中的普通文本、进度、用户消息和其他请求都不作为答复。权限请求留给用户，脚本不自动审批。

该通道不适合多个项目共享同一助理上下文：全局目标记录绑定一个项目；跨项目或已有未解决请求会拒绝。对话 ID 精确路由的桌面适配仍待另行实现；随软件安装的 codebuddy --resume 是续接 CLI 的另一种入口，不能冒充向当前桌面聊天投递。

## 命令

先完成官方授权，在自己的运行环境设置令牌；不要把令牌粘贴进聊天、命令参数、绑定文件或公开包。

```bash
node /absolute/ai-chat/scripts/workbuddy-localassistant.mjs preflight --endpoint local-assistant
node /absolute/ai-chat/scripts/workbuddy-localassistant.mjs send \
  --project-root /absolute/project --state-dir /absolute/project/.ai-company/requests \
  --project project-id --request-id unique-id --endpoint local-assistant \
  --message-file /absolute/project/message.txt --authorized
node /absolute/ai-chat/scripts/workbuddy-localassistant.mjs wait --request /absolute/project/.ai-company/requests/unique-id.json --timeout-seconds 45
```

令牌缺失时不会发 HTTP 请求；请求失败不自动重发。发送结果不确定且未取得 message_id 时保持 SEND_UNKNOWN，不能通过更换请求 ID 猜测恢复。令牌续期由官方授权机制管理，脚本不自动进行新授权或登录。

代码使用固定官方 HTTPS 地址，不允许把 Authorization 重定向到其他地址。隔离测试使用假 HTTP，不消耗真实额度。尚未获得本机 OAuth 接入授权，未完成真实本地助理闭环。
