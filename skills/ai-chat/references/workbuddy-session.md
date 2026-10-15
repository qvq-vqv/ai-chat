# WorkBuddy 已有桌面对话：本机 ACP（实验）

本适配器以准确 UUID 筛选 `~/.workbuddy-ai/sessions/<pid>.json` 中的 interactive 记录。**不依赖记录里的 `endpoint` 字段**：该字段经常不写，而会话其实正在 127.0.0.1 上监听；同一 UUID 还可能同时存在一条已失活的残留记录（带陈旧 `endpoint`）与一条仍存活的记录。因此解析改为把**登记记录**与**可观测的进程身份**双向绑定：

- 调用方必须提供**获准的目标 cwd**（`--expected-cwd`）。scope 来自绑定，候选记录不得自证；缺失则 `EXPECTED_CWD_REQUIRED`。
- 仅对初筛后的记录查该 PID：存活（区分 `ESRCH` 已失活与 `EPERM` 不可检视）、进程 cwd 等于登记 cwd、可执行文件 realpath 后经 `Info.plist` 核实为已安装 WorkBuddy 应用（`CFBundleIdentifier` + `CFBundleExecutable`，不是前缀或 bundle 名）、监听端口由该 PID 拥有且为 loopback。
- 登记的 `endpoint` 仅作提示，其端口必须由同一 PID 拥有。
- 多个不同 PID 通过核对，或单进程拥有多个 loopback 监听端口 → `REFUSE_AMBIGUOUS`，**不猜端口**。心跳只记录，不参与选择。
- 发现前后各重读一次登记并重核身份；任一变化 → `IDENTITY_CHANGED`。**不删除、不改写登记文件。**
- **放行必须有真实进程启动身份**：用 OS 提供的进程启动时间（`/bin/ps -p <pid> -o lstart=`，子进程固定 `LC_ALL=C`、`TZ=UTC`，秒级精度，解析为 UTC epoch 秒）与登记 `startedAt` 核对（容差 ±2s）。登记文件 birthtime 与 `startedAt` 都来自登记资料，二者一致只能证明**登记自洽**，不能排除 PID 复用，因此只作为 `registration_consistent` 记录，**绝不是放行依据**。取不到真实进程启动身份时：`process_identity_verified=false`，候选仍可上报，但 `preflight`/`deliver` **必须阻断**（`PROCESS_IDENTITY_UNVERIFIED`）。解析失败、权限不足、进程消失、输出格式异常一律阻断。派单前的指纹包含该真实启动身份，preflight 与 deliver 之间、以及 `session/load` 前后只要发生变化即阻断。
  - **不使用任何未经验证的底层二进制偏移读取**（早期版本的 `sysctl` `kinfo_proc` 偏移解析已删除，未经 macOS 结构体布局核实，不得依赖）。
  - 本机现状：`ps` 在本沙箱被拒（exit 127/126）→ **本沙箱取不到真实进程启动时间，因此本机默认阻断**（刻意失败关闭）。需要能提供该只读信息的运行环境；probe 的 `exec`/`kill` 均可注入以便隔离测试与外部核实。不要把登记时间当作进程时间。

不探测其他会话、不读账号凭证文件。国内版本需明确传 `--config-dir` 到其实际目录。目标无活跃进程返回 `TARGET_NOT_ACTIVE`，不代用其他聊天、官方 local-assistant 或新 CLI。

协议由安装软件的 ACP 客户端代码核对，并参考作者的 [workbuddy-acp-bridge](https://github.com/Kxiandaoyan/workbuddy-acp-bridge) 原理；这是第三方发现的本机入口，不承诺为 WorkBuddy 官方稳定桌面 API。其 Windows 验证不能替代本机 Mac 验证。本包未执行或安装该仓库代码。

调用 connect 握手取得临时连接身份（仅在内存），initialize；投递时先用 session/load 加载准确的已有会话，建立该连接的原生消息处理循环，再调用 session/prompt。session/load 不传 takeWriter 或 evict；写入权冲突时停止，不抢占桌面客户端。preflight 只握手，不加载会话或发送消息。发送前核对该准确会话的原生最终记录证明空闲。每次只有一个未结束请求。401/403、权限请求或目标变化均停止，不降级认证、不自动批准工具。

**强制零积分闸门**：在准确目标、验证空闲、`session/load` 取得目标锁之后、`session/prompt` 之前，读取**该次加载返回**的 `models.currentModelId` 与 `models.availableModels` 中唯一匹配条目的 `_meta.credits`。仅当严格等于 `x0.00` 才放行；非零、空、缺失、匹配不唯一或目录为空一律抛 `ZERO_CREDIT_GATE` 并**不发送 prompt**。不退回 transcript 或历史 CLI 报价，不自行切换模型，不把空报价当免费。放行后把脱敏报价（模型 ID、报价、观测时间）原子写入 `<reply_file>.quote.json`（0600）；该证据只证明**报价**，实际扣减仍为 `UNKNOWN`。放行前会再次复核准确目标。

闸门阻断时在请求状态写入 `zero_credit_gate={decision:'BLOCK',prompt_sent:false,…}`。Relay 仍按既有语义把该次 send 记为 `SEND_UNKNOWN`，但该标记明确表明 **prompt 从未发出**，据此区分「未发送」与「发送结果未知」，不会错误解锁或自动重投。

接收需要匹配本次 RPC 最终结果 stopReason=end_turn，以及含唯一项目、请求、目标与 nonce 的 ai-chat-response 信封。流中断或超时不重发；status/wait 可以从请求记录的准确本机 transcript 读取 status=completed 的目标 assistant 信封以恢复。回复文件仅是本次结果缓存，不能以旧 assistant 或流结束冒充完成。

```bash
node /absolute/ai-chat/scripts/workbuddy-session.mjs preflight --endpoint EXACT_UUID --expected-cwd /absolute/target/workspace
node /absolute/ai-chat/scripts/workbuddy-session.mjs send --project-root /absolute/project --state-dir /absolute/project/.ai-company/requests --project PROJECT --request-id UNIQUE --endpoint EXACT_UUID --expected-cwd /absolute/target/workspace --message-file /absolute/project/message.txt --authorized
node /absolute/ai-chat/scripts/workbuddy-session.mjs wait --request /absolute/project/.ai-company/requests/UNIQUE.json --timeout-seconds 45
```

`--expected-cwd` 是必填项，指向该桌面对话的工作目录（与登记 `cwd` 一致）。同族 `workbuddy-follow` 复用同一加固发现契约，但其原生 `/reply` 追加路径**尚未**加报价门禁——该路径不使用 `session/prompt`，属已披露的未覆盖范围。

当前已完成隔离测试和准确目标预检查，尚未通过真实收发。Mac 5.7.6 现场发现：桌面客户端持有活跃写入权时，session/load 返回 -32000 / writer_occupied；不得用 takeWriter 踢出客户端来制造成功。另一个原生 sessions/:id/reply 追加入口在本机返回 401，未获得合法宿主认证前不调用发送、不自动代取凭证。无活跃 worker 时不自动切换窗口；后台激活能力还需独立实现和验证，不能声称已解决多个项目抢前台问题。

WorkBuddy 作为调用端主动使用 codex-session 并自行 wait 的真实闭环已在用户指定的 Mac 测试聊天通过；这不需要 WorkBuddy 接收适配器，也不能证明 Codex 主动派单到 WorkBuddy。公司自动启动应按方向分别记录验证，接收侧缺口不能用调用侧成功填补。
