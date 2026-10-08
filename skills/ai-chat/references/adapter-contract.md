# 可扩展通信适配契约

适配单位是软件入口，不是模型品牌。每个目标必须说明：软件及版本、入口类别、准确会话身份、调用端工具要求、授权范围、费用类别、实际验证证据。已有软件订阅与独立 API 可能采用不同额度，不能自动互换。

## 注册

一个 manifest 是 JSON 文件，放在项目 `.ai-company/adapters/`，或用户明确指定的 registry。路径相对该 manifest 定位；跨机器分享时不要携带私人绝对路径和会话 ID。外部适配器使用 implementation=skill；路由器只检查资源和能力声明，不执行文件、不证明声明真实性。

```json
{
  "schema_version": 1,
  "id": "example-session",
  "target_app": "example-software",
  "mode": "existing-session",
  "implementation": "skill",
  "skill": "/absolute/installed/example-skill/SKILL.md",
  "caller_requires": ["local_command"],
  "capabilities": {
    "send": true,
    "receive": true,
    "request_correlation": true,
    "final_detection": true,
    "recover": true,
    "project_isolation": true,
    "existing_session": true
  },
  "verification": "声明待核实；先读实现，后做本项目真实握手",
  "billing": "说明实际账号或费用来源"
}
```

同 ID 注册冲突应拒绝，不覆盖内置适配器。不能把“我能调用模型 API”注册成“我能向网页已有对话发送”。resumed-cli 必须说明是否会启动独立进程、是否能与原活动进程并存；无法保证同会话串行时停止，不另起进程争用会话。

## 行为要求

- preflight：只读核实入口、固定身份、调用端权限和版本，不能以 ping 的名义产生未授权的真实对话。
- send：接收 project_id、request_id、已确认 endpoint 和消息；保存正文摘要、关联身份和投递证据；同一请求重复调用不重复投递。保存可持久恢复的 request_handle。
- receive/status/wait：读取该 handle 的状态，关联到本次请求的最终回复；普通进度和其他请求不能解锁。最终检测基于可靠终止事件或同步调用完成与完整结果，不能只按“最近消息”猜测。
- normalize：返回 status、request_handle、project_id、request_id、response（decision、reply）及必要证据。错误/中断保留原始类别和明确说明；状态不确定时用 UNKNOWN。超时附 timed_out=true，保留实际状态。
- recover：进程重启后续接同一 handle；发送结果不确定时先核实，不自动重投。无法确认的旧请求阻止向同目标提交依赖请求。
- isolation：每个项目独立绑定/运行记录；同一目标会话串行；其他项目不读写这份绑定。能力与数据权限由工具实际边界控制，manifest 布尔值不提供访问隔离。

公司决策为 ASSIGN、ACCEPT、REVISE、ANSWER、NEED_USER、BLOCKED、GOAL_COMPLETE。适配器可使用目标原生 JSON、完成事件或自有信封，但需可靠映射。若目标只能返回普通文本，协议约定和解析必须实际实现并验证；不能由员工猜测 ACCEPT/GOAL_COMPLETE。

## 验证门槛

隔离测试验证去重、串行、超时续接、失败/中断及两项目结果隔离。真实握手验证准确会话收到唯一请求、响应关联正确、员工自行读回并能继续。测试 fixture 不证明软件连接成功。将 adapter_id、版本、endpoint、日期、结果证据记录在项目内；版本或身份改变时重新 preflight，必要时重做握手。

## 已确认的入口差异（2026-10-08）

- [Claude Code 程序化调用](https://code.claude.com/docs/en/headless)：提供 print/JSON 和会话继续机制；不等同于注入一个正在运行的 Claude 网页或客户端窗口。本包未实现适配器。
- [Grok 官方 API](https://docs.x.ai/developers/rest-api-reference/inference/chat)：API 入口，不据此推断已有网页对话可投递。本包未实现适配器。
- [GLM 官方 Chat Completion](https://docs.z.ai/api-reference/llm/chat-completion)：需要 API 授权的推理入口，不据此推断网页版或 IDE 对话可投递。本包未实现适配器。

没有跨所有软件的统一“已有会话发送+最终回复接收”入口。这里统一的是适配契约和公司流程，软件实现仍需分别接入。

## 内置软件适配的完成依据

Codex 使用原生 task_complete 加关联最终信封。Antigravity 当前使用原生投递加项目内请求专属回复文件，WorkBuddy 本地助理使用官方历史加目标发出的最终信封；后两者采用协作式完成记录，不能据此判断原生会话进程结束或自动检测所有中断。WorkBuddy mode 为 local-assistant，不是任意桌面 existing-session。主动端只需运行目标适配器和读回，无需自身的接收适配器。
