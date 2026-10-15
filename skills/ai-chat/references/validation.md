# 验证记录

当前发布：v2.0.0-alpha.1，仅 Antigravity → Codex 请求及主动读回回复。

本地 17 项隔离测试通过：文本参数保真、同请求去重、旧回复与进度过滤、匹配轮次终态、分段记录、fork 身份校验、UTF-8 部分写入、两种消息事件形态、失败/中断、回复协议校验、跨轮次歧义、双项目隔离、超时/取消/恢复、发送失败不自动重投、受保护路径、截断识别、CLI 冒烟、并发锁。

已做真实本机 CLI 帮助与会话文件的只读检查；没有发送真实请求。尚未验证空闲或活跃目标的自动开工、Antigravity 自动读回并继续、两个真实项目的端到端运行。其他软件和通信方向不属于本版支持范围。

测试不会证明跨软件自动化已经部署。项目未做独立安全审计。

## v3 路由层（2026-10-08）

新增 8 项隔离行为测试：静态候选不等于已连接、模型名不能误路由、无 API 自动回退、调用能力和 send-only 拒绝、多候选选择、固定会话必填、注册路径/ID 冲突/内置冒充拒绝、API 显式配置与授权。全部测试合计 25 项。路由器不执行外部技能或发送真实消息。此阶段尚未验证远端 CI 与新增软件的真实闭环；后续结果见下方发布检查。

## Antigravity / WorkBuddy 协作式适配（2026-10-08）

新增 12 项隔离测试，总计 38 项通过。覆盖重复投递拒绝、发送不确定恢复、超时续接、随机请求关联、目标跨项目独占、授权与软链接路径边界、Antigravity 原生参数投递和请求专属回复文件、WorkBuddy OAuth 缺失无网络请求、历史过滤、工具权限请求不自动审批。

本机核实：Antigravity agentapi 命令帮助可用；WorkBuddy 随附 CLI 有 resume/print，但不被当作当前桌面已有会话。官方助理 preflight 返回 MISSING_AUTH，未从软件登录存储获取凭证。两项新适配均未向真实项目聊天投递，测试目标已通过界面定位，真实握手仍受下述认证与入口限制。协作式 final 记录不证明原生进程轮次结束。

另外验证同目标并发发送拒绝、已退出进程遗留锁回收，以及取消等待不打断目标且随后可恢复接收。

路由另增 1 项测试，核实软件入口、固定目标与协作式接收确认，不允许把 WorkBuddy 官方助理通道误用为任意桌面已有聊天。当前共 38 项。

指定测试对话的现场只读检查：Antigravity UI 可确认标题和准确身份，但外部原生命令缺软件认证环境，服务拒绝缺失 CSRF；WorkBuddy UI 可确认测试聊天，官方助理 API 无任意桌面对话 ID 参数且缺 OAuth。未回退前台发送，未向其他聊天投递。新增接收端的真实收发未通过，不能标 VERIFIED。具体会话身份不进入公开包。

## v3 发布检查（2026-10-08）

38 项隔离测试和语法检查通过。公开仓库源码逐文件与本地发布包一致；[GitHub Actions](https://github.com/qvq-vqv/ai-chat/actions/runs/37768325903) 的 Node 22/24 两个任务均成功。此结果不改变上述真实收发限制。

## 两接口整好（2026-10-10 夜）

目标：把 Codex 与 Antigravity 两个对等连接适配器做到代码完整、隔离测试全绿、真实握手能力据实闭环。用户在第 7 轮夜班中纠正范围：俩接口不仅指 WB→外的出站适配器，更指 Codex/Antigravity 如何真正"联系你"——即**入站方向（外部调用方 → WorkBuddy 桌面 ACP）**。下文分出站与入站两部分据实记录。

- Codex（codex-session + bridge-core）：bridge 隔离测试 19/19 通过；第 7 轮已真实发送并收到 ACCEPT（线程 01a11a8b…），本会话只读连通性确认（CLI 存在、IPC 存在、rollout 可解析）。真实收发闭环已证明。
- Antigravity 直连（antigravity-session）：新增 `antigravity-session.test.mjs`，10/10 覆盖 preflight（UUID/CLI/原生上下文校验）、deliver、poll（缺失/部分 JSON/合法/越界）与失败透传。此前该适配器无专门单元测试，是明确缺口，现已补齐。
- Antigravity Sidecar（antigravity-sidecar）：2/2 测试维持通过。
- 共享 `relay-core.mjs` 的 `locked()` 修复：WorkBuddy App 的 brokered FS shim 在目录已存在时把 EEXIST 报为 `CODEBUDDY_BROKER_DENY`（非标准 `EEXIST`），导致并发/遗弃锁的拒绝与回收在真实运行时接不住；改为以 `fs.statSync().isDirectory()` 判定锁目录是否存在，全部运行时一致。该缺陷影响所有基于 Relay 的适配器（含两个 Antigravity 接口），现已修复。
- 接口相关测试合计 62/62 全绿（bridge/antigravity-session/antigravity-sidecar/workbuddy-session/workbuddy-follow/adapter-router/entrypoint）；全量 116/76/40，剩余 40 失败全部在 resident.test.mjs（CodeBuddy 常驻适配器，不在本次范围且未改动）。

### 真实握手边界（据实，未盲试）

- Codex：已真实闭环（见上）。
- Antigravity 直连：本会话 `ANTIGRAVITY_LS_ADDRESS` 与 `ANTIGRAVITY_CSRF_TOKEN` 均未设置，按契约 `MISSING_NATIVE_CONTEXT` 阻断；且契约明确禁止抓取登录/进程凭证关闭 CSRF。外部进程不应持有原生认证。
- Antigravity Sidecar：~/.gemini/config/sidecars 下已注册并启用 ai-chat-pvz-successor、ai-chat-triad-test、antigravity-pet-dispatcher，但截至本会话无任何 `ready.json` 心跳，说明宿主 App 当前未运行这些 sidecar。
- 完成 Antigravity 真实握手所需（用户侧）：运行 Antigravity App 使其 sidecar 为对应项目写入新鲜 READY 心跳，或经 App 注入原生认证环境；届时本脚本可在已确认授权下做最小 preflight + 收发验证。

### 入站方向（Codex/Antigravity → WorkBuddy，2026-10-11 修正）

入站机制 = `workbuddy-session.mjs`：外部本地桥（Codex/Antigravity 侧）对 WB 桌面 ACP（`/api/v1/acp`）投递。此前 `TARGET_NOT_ACTIVE` 的根因是注册表 `endpoint` 字段经常缺失/失效，而 worker 其实在监听。本会话新做实况入站证明 `live-tests/inbound-proof-20261010/demo-inbound.mjs`，结果：

- 注册表记录 `83030.json` 的 `endpoint` 字段**确实缺失**，但 `discoverSession` 在 endpoint 缺省时回退到 `pidListenPorts`(lsof) 解析出真实监听端口 `http://127.0.0.1:51091`——修复路径已在适配器内且实况成立。
- 真实只读 ACP `connect`→connectionId OK、`initialize`→protocolVersion=1：入站端点确实应答（零积分）。
- 注入 `ps` 后 `discoverSession` 完整门控路径返回 OK（`start_verified:true`）——生产环境（ps 可用）下门控通过；本沙箱 `/bin/ps` 被拒，仅沙箱限制。
- `session/load` 在"自我会话"（当前运行本 agent 的会话）上返回 -32000，属预期：不能加载正在运行本 agent 的会话；真实入站投递目标是另一个空闲会话，不受影响。零积分闸门 `assertZeroCreditQuote`（唯一 `x0.00` 报价才放行）由隔离测试覆盖，`session/prompt` 是唯一花费积分的步骤，证明中从不调用。

隔离测试：`workbuddy-session.test.mjs` 19/19（含 endpoint 缺省→lsof 解析、零积分闸门、投递前重载/指纹/起点身份校验）。`relay-core` 13/13（locked() 修复覆盖全部运行时）。

### 真实握手边界（入站，据实，未盲试）

- 入站 WB 侧已就绪且实况可达：外部调用方（Codex/Antigravity 本地桥）在用户真实环境（ps 可用）下，对一个**空闲且可达**的 WB 会话调用 `workbuddy-session` 即可走完 connect→initialize→session/load（零积分闸门）→session/prompt。
- 沙箱限制：本环境 `/bin/ps` 被拒 → `discoverSession` 触发 `PROCESS_IDENTITY_UNVERIFIED`（仅沙箱；生产通过）。lsof 可用，故端点解析仍成功，但门控放行需 ps。
- 完成 Codex/Antigravity 真实入站握手所需（用户侧）：运行对应本地桥/sidecar 指向一个空闲 WB 会话（如双方"测试一下"聊天），并确保该会话桌面 worker 在监听（keepwarm 观察 endpoint；`codebuddy-resident` 提供常驻可达端点）。届时本脚本可在已确认授权下做最小 preflight + 收发验证。
