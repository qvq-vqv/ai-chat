# CodeBuddy 独立常驻会话适配

实际入口为 `app=codebuddy, mode=resumed-cli, adapter_id=codebuddy-resident`。不是原WorkBuddy桌面聊天，也不继承其会话身份/验证结论。优先用户明确指定的软件登录和模型；不能把“同品牌”当同订阅证明。模型目录、收发成功、额度测量分别核实。

## 接收和职责

一个项目角色绑定一个独立宿主与原生会话。宿主为独立官方CLI进程提供有界、本机密码认证服务；只有宿主能持有随机网关密码，不导出账号令牌。调用端通过项目内队列通信，不需要网关密码。接收依据是准确原生SSE终态＋唯一匹配的ai-chat-response最终信封。错误文本即使带completed标签也不是模型任务成功。

当前启动配置禁用所有内置工具和MCP，仅用于只读通信试验。Gateway可能覆盖plan权限；因此不能据plan标签开放施工权限。生产工具执行需单独授权和验证，不自动改配置。

## 用户批准的私有绑定

绑定不随发布包分发。用真实绝对路径填写：

```json
{
  "schema_version": 1,
  "authorized": true,
  "project_root": "/absolute/project",
  "project_id": "project-id",
  "endpoint_id": "stable-approved-binding-uuid",
  "runtime_dir": "/absolute/project/.ai-company/resident/role/inbox",
  "workspace": "/absolute/project/.ai-company/resident/role/workspace",
  "cli_entry": "/absolute/official-codebuddy/bin/codebuddy",
  "config_dir": "/absolute/project/.ai-company/private-cli-profile",
  "model": "user-approved-model-id",
  "expires_at": "ISO-8601 time within the next 10 minutes",
  "allow_create_session": true
}
```

使用完整官方CLI；WorkBuddy随附包可能只有headless，没有TUI登录模块。登录由用户通过官方界面完成，程序不读取/复制账号存储。config_dir使用已有项目私有配置；没有登录时返回需要登录，不能改用API Key。到期不自动续期；allowed_create只用于首次明确授权新会话。runtime/workspace与登录配置须隔离，不能逃出project_root。

## 命令

下面命令不会自动安装服务。另一个已授权的终端/宿主运行接收入口（到期退出）：

```sh
node /absolute/ai-chat/scripts/resident-host.mjs serve --binding /absolute/project/binding.json --authorized
```

调用端：

```sh
node /absolute/ai-chat/scripts/codebuddy-resident.mjs preflight --binding /absolute/project/binding.json --endpoint APPROVED_UUID
node /absolute/ai-chat/scripts/codebuddy-resident.mjs send --binding /absolute/project/binding.json --project-root /absolute/project --state-dir /absolute/project/.ai-company/requests --project project-id --request-id unique-id --endpoint APPROVED_UUID --message-file /absolute/project/message.txt --authorized
node /absolute/ai-chat/scripts/codebuddy-resident.mjs wait --binding /absolute/project/binding.json --request /absolute/project/.ai-company/requests/unique-id.json --timeout-seconds 45
```

保存request_file，后续status/wait同一请求。没有新鲜ready不发送；ready不证明业务推进。停止本宿主可发SIGTERM给自己的宿主进程，或原子写runtime_dir/STOP.json为 `{}`；不杀整个WorkBuddy或其他服务。STOP 在宿主启动前已存在时不启动后台；执行中每100ms核对，只终止本次获准临时后台，原请求结果未知仍保留。后台自身已退出时停止发布ready；启动阶段也受宿主停止/到期信号约束。

首次通过ACP创建并保存native-session.json；同时核对原生 models.currentModelId 与批准模型，缺失或不匹配阻断，不主动切模型。重启准确load并核对原ID，失败阻断而非新建。最终回复持久保存后，即使宿主停止也可读回。存在claim但无最终结果时禁止重发；只有已知原run可只读恢复流，run不在则结果未知。

网关等待超时仅表示结果未知，即便出现原生 error 标签，也保留 claim/receipt 与 Relay 未决所有权，禁止发下一单。测试模型预算默认120秒，可在首次绑定时设置 run_timeout_ms（1000—180000）；实际派单预算不超过本宿主剩余有效期。更改预算属于绑定 scope 变更，已有 native/request 状态不能静默复用，续期只改 expires_at。短观察超时不等于员工已停止。

旧版 NATIVE_EXECUTION_ERROR 可能只是网关等待失败：遇到该遗留记录，poll 返回未知，新的 preflight 阻断并要求对账，保留旧文件，不靠新请求绕过。

残留host.lock为BUSY_UNCERTAIN，不自动删除。排查自己的持久请求与进程，不通过换目录/新ID绕过。限流、登录或协议问题只影响本绑定。fixture覆盖不证明真实长期保活、额度归属或系统休眠。

## 验证

```sh
node --test /absolute/ai-chat/scripts/resident.test.mjs
```

首次现场验证必须记录版本、明确模型、绑定与native_id、关联请求/最终结果、空闲再接收、宿主重启及调用端离线读回。查询注册表或manifest候选不等于VERIFIED。

宿主在投递前也独立检查本绑定其他claim：无可核验最终结果、旧版不确定失败或记录损坏均阻断新单，不仅依靠Relay锁。临时后台强制CODEBUDDY_DISABLE_SHELL_SNAPSHOT=1，关闭环境快照预热及创建路径；不导出临时网关密码。

## 零积分策略

用户不愿消耗积分时在新批准绑定填写 `"model":"hy3", "require_zero_credits":true`。此字段进入scope；不能在旧绑定原地改模型/策略并复用原native状态。每次POST前通过原生ACP准确load同一会话取得model目录，验证选中hy3、唯一对应模型credits=x0.00及live身份一致；缺失/非零/查询失败阻断，不fallback。保存独立pricing记录：报价时间、model、credits，actual_deduction仍为UNKNOWN。元数据报价不是账单证明，也不能保证服务端在检查后绝不变价；不作永久免费保证。现场仅纯文本、无工具，不请求图像或视频等收费生成。
