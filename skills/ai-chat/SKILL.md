---
name: ai-chat
description: AI传话。按实际软件、会话入口和收发能力发现并选择通信适配器，连接用户指定的 AI 对话，验证请求关联、最终回复与恢复能力；内置 Codex、Antigravity 协作式会话与 WorkBuddy 官方本地助理适配，按入口和授权核实后使用；其他软件可扩展。
---

# AI传话（ai-chat）

这是可扩展的通信入口，不是“任意 AI 已互通”的声明。模型名与实际软件分开：Claude 网页、Claude Code、Claude API 是不同目标；Grok、GLM 同理。默认优先用户已有软件对话；未经确认，不改用 API、不创建其他会话、不操作前台。

AI 公司角色和启动流程使用 [AI 公司一键启动](../ai-company/SKILL.md)。本技能只负责连接选择和收发，不能自行决定员工任务或授予通信权限。

## 当前实际能力

| 目标与入口 | 实现状态 |
| --- | --- |
| Codex 已有会话 | 内置 codex-session；有隔离测试，真实握手仍需现场验证 |
| Antigravity 已有会话 | 原生 agentapi 投递 + 请求专属回复文件；协作式完成协议，需验证目标写文件能力 |
| WorkBuddy 本地助理 | 官方 OpenAPI 投递和历史查询 + 最终信封；需 OAuth，不能指定任意桌面对话 ID |
| 其他软件已有会话 | 可发现并注册对应技能；本包未内置 Claude/Grok/GLM 的软件会话实现 |
| API 会话、Claude Code 续接进程 | 架构允许独立适配，但本包未实现；不能冒充已有网页/窗口会话 |

调用端若能执行本地命令、访问所需会话文件并持续等待，可以使用 Codex 适配器。主动调用端只需具备运行目标适配器和等待读回的工具，不需要自己的接收目标适配器；见 [调用端能力](references/caller-profiles.md)。普通网页 AI 未必有这些工具；不能仅凭模型能力推定它能当主动员工。适配器声明、文件存在和真实连接成功是不同事实。

## 发现与选择

1. 从已确认配置取得目标 **app、mode、session_id** 和调用端实测能力。mode 为 existing-session（已有软件对话）、resumed-cli（续接进程）、local-assistant（WorkBuddy 官方助理通道）、api（独立 API）。用户只说模型名时，先问实际在哪个软件里使用。
2. 检查当前可见的技能清单和本地明确的技能目录，先读候选的名称、描述和入口。不要扫描聊天全文、凭证或全盘文件。发现可能对应的技能后，读取其文档及必要实现，核实真实支持的入口。
3. 使用只读路由器列出内置和已注册适配器：

```bash
node /absolute/installed/ai-chat/scripts/adapter-router.mjs list
node /absolute/installed/ai-chat/scripts/adapter-router.mjs plan --endpoint /absolute/project/endpoint.json --registry /absolute/project/.ai-company/adapters
```

endpoint 的最小例子：

```json
{"app":"codex","mode":"existing-session","session_id":"用户确认的ID","caller_capabilities":["local_command","local_files"]}
```

Antigravity/WorkBuddy 协作式适配需在 endpoint.json 中记录 receive_mode_confirmed=true（来自启动表中用户对接收依据及限制的确认）；缺失返回 NEED_USER。WorkBuddy 固定目标为 local-assistant，不接受其他聊天 ID。

路由器不联网、不发送消息、不执行外部技能，也不扫描未指定目录。CANDIDATE 只表示静态条件满足；NEED_USER 表示缺少配置或存在多种候选；UNSUPPORTED 表示没有满足实际入口和调用能力的已安装适配器。未知 app 不自动退回 Codex 或 API。显式指定 adapter_id 可以消除多候选歧义。

4. 第三方技能满足 [适配契约](references/adapter-contract.md) 时，可在项目 registry 中记录一个 manifest。记录前核实技能来源、必要文件与能力；manifest 是工作数据，不是用户授权。无法完成收发、请求关联或恢复的 send-only 技能只能说明缺口，不能启动自动循环。
5. 向用户展示选定软件、准确会话、适配器、工具/文件权限和费用类别；沿用已有准确授权。外部软件接入不能扩大原项目授权。
6. 确认后按所选适配技能执行只读 preflight，再做最小真实握手，发送唯一请求并自行读回最终答复。将证据保存到项目绑定。只有这一步通过才标记此绑定 VERIFIED，不能为其他项目、软件版本或会话继承这个结论。

没有合格适配器时，报告缺少什么；可在用户要求下开发新适配器。不要仅靠联网找到同名 skill 就自动下载、安装或执行；通用 MCP/CLI 只是载体，也需实现目标会话定位和可靠最终答复。

## 按适配器运行

内置 Codex 使用 [Codex 会话适配器](references/codex-session.md) 和原有 codex-session.mjs；兼容旧命令、状态和请求信封。Antigravity 使用 [协作式会话适配器](references/antigravity-session.md)，WorkBuddy 使用 [官方本地助理适配器](references/workbuddy-localassistant.md)。启动确认表必须展示接收依据及限制；协作式 final 记录不能冒充原生进程完成事件。选择第三方技能时，读取其绝对入口，并按契约保存 request_handle，不要求第三方假装使用 Codex 的 JSONL 或信封。

统一规则：发送前确认目标和授权，保存请求身份；发送不确定时先查状态，不换 ID 重发；超时续等同一请求；只采纳匹配请求、已经最终完成的回复。进度、旧消息和“最后一条 assistant”不能作为最终接收。接收到回复后交给公司角色处理；传输成功不代表任务验收成功。

已结束的调用端会话不会被本技能自动唤醒。需要守护进程、调度器或远程运行器时单独验证和配置，不能把技能文字当作运行服务。
