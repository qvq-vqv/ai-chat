# 规则基线、业务核对与关联样例

在建立/修订合同、审查提交或规划多个岗位时读取；这些记录不是新的传输schema；需要重复结构核对时可用[可选只读检查器](contract-checker.md)。优先引用已有OpenSpec任务和项目权威状态，缺项只按其实际影响补齐。

## 附属记录的权威位置

在项目既有任务状态或绑定旁附属文件保存规则基线、verified_links与资源责任，并在该权威状态入口注明位置。schema2不加未经支持字段；connection.verification引用实际握手记录，额外方向信息存于上述附属记录。保持每条请求的原state-dir/归属，记录文件不是新的请求目录。

verified_links每条列：调用岗位→目标岗位、准确端点、入口/适配版本、请求handle、验证时间、最终依据与有效限制。回包仅证明该方向请求—应答，不推出反向主动投递。未知信息标未知；附属记录不成为用户授权。

## 规则基线与换版

合同引用所需模块及可追溯基线，可用发布版本对应的不可变副本或模块内容哈希；若仅文件路径且内容会变化，不能算版本锁定。没有发布版本时只记录本任务所需模块的哈希及可恢复副本，不每轮重读整个skill。基线是验收/权限核对依据，不授权覆盖当前用户指令。

更新记录旧/新基线、变化理由、受影响合同/条件、生效范围和员工确认依据。既有在途请求仍按原合同评审；影响新执行的部分先停并通过获准方向确认修订，不影响的步骤继续。用户撤销权限立即优先，不等员工确认才生效。安全性或范围冲突回架构师/用户，不以“固定旧版本”为理由继续越权。只改无关模块不全量重验；通知无回执标未确认。

## 业务核对清单

调用端核对传输身份，架构师核对以下内容；员工自测时也可用。权限、质量和独立性仍由人或模型核对；可选检查器仅自动提示结构/版本关联问题，不强制执行合同。

- 项目、目标/任务/合同修订、负责岗位、提交及裁决的关联是否一致；旧提交按原版本审查，不直接删弃。
- 授权来源与允许范围是否真实覆盖动作；合同、AI建议或样例本身不授予权限。
- 输入/规则/产物基线是否可追溯，是否存在替代修订；所有引用由接收端实测能读，缺证据标NOT_VERIFIED。
- 依赖与资源责任是否有效；已存在同用途请求handle先恢复，不能因新文件或重复裁决重新发送。
- 每个验收项是否有真实方法、环境、结果和证据；存在结构字段不代表质量通过，自测不当独立验收。
- 裁决是否只接受被验证范围；下一动作区分已有合同、请求下一合同、真实阻塞或全目标完成。

## 完整关联样例（全部虚构，不可据此执行）

以下JSON块是可兼容附属工作记录，不是原生信封。调用协议仍使用contracts.md及选定适配器；response.reply可引用合同正文。demo规则版本表示演示固定副本，实际使用必须换成可核实基线及真实授权来源。路径为项目内示例路径，没有对应真实文件或授权。

```json
{
  "record_type": "contract",
  "project_id": "demo-project",
  "goal_revision": 1,
  "task_id": "document-1",
  "revision": 1,
  "owner_role": "documentation-worker",
  "authorization_reference": "demo-human-approval-1",
  "rule_baseline": {"id": "demo-fixed-rules-1", "modules": ["contracts.md", "acceptance.md", "loop.md"]},
  "goal": "生成一份只读规则判读报告",
  "inputs": [{"reference": "inputs/rules.md", "version": "demo-input-v1"}],
  "allowed_actions": ["读取inputs/rules.md", "新建reports/document-1.md"],
  "resources": [{"reference": "reports/document-1.md", "writer": "documentation-worker", "baseline": "absent", "release_condition": "无在途写入且审查者确认交付"}],
  "dependencies": [],
  "acceptance": [{"id": "A1", "criterion": "报告说明未知发送不能换ID重投", "evidence_required": "报告正文和输入版本"}],
  "deliverables": ["reports/document-1.md", "逐项验收记录"],
  "exclusions": ["修改输入规则", "外部通信", "运行服务"],
  "stop_conditions": ["输入版本改变", "出现其他写入者"],
  "report_to": "architect-role"
}
```

```json
{
  "record_type": "delivery",
  "project_id": "demo-project",
  "goal_revision": 1,
  "task_id": "document-1",
  "revision": 1,
  "owner_role": "documentation-worker",
  "rule_baseline_id": "demo-fixed-rules-1",
  "submission_request_id": "demo-submit-1",
  "artifact_version": "demo-report-v1",
  "results": [{"acceptance_id": "A1", "input_version": "demo-input-v1", "method": "读取输入并核对报告段落", "environment": "demo-local-files", "result": "PASS", "evidence": "reports/document-1.md#unknown-send", "observer": "documentation-worker", "independence": "self-test"}],
  "known_failures": [],
  "not_verified": ["真实模型执行此规则"],
  "pending_operations": [],
  "decision_requested": "请审查当前报告是否符合A1",
  "next_suggestion": "如剩余目标明确且无合同则请求下一合同"
}
```

```json
{
  "record_type": "verdict",
  "project_id": "demo-project",
  "goal_revision": 1,
  "task_id": "document-1",
  "revision": 1,
  "submission_request_id": "demo-submit-1",
  "artifact_version": "demo-report-v1",
  "reviewer_role": "architect-role",
  "review_method": "独立读取演示输入和报告对应段落",
  "review_results": [{"acceptance_id": "A1", "result": "PASS", "evidence": "reports/document-1.md#unknown-send"}],
  "decision": "ACCEPT",
  "accepted_ids": ["A1"],
  "accepted_scope": "仅document-1修订1的A1报告内容",
  "limitations": ["不证明真实模型行为"],
  "next_action": "保存裁决；若完整目标未达成且无有效下一合同，员工通过原获准方向REQUEST_TASK",
  "next_request_handle": null
}
```

最后一项为null表示尚未请求，不能伪装已投递。真实请求发出后在权威状态保存关联键及原handle；未知时续查同一请求。示例不要求在原生response额外增加上述字段；accepted_ids仅给可选附属检查器明确阶段接受项，不能扩张自然语言accepted_scope。

### 请求下一合同的正文例子

用于已获准的员工→架构师方向；先查相同关联键是否已有handle。request_id为未投递的虚构例子，不能拿它重放真实请求。

```json
{
  "project_id": "demo-project",
  "goal_revision": 1,
  "task_id": "document-1",
  "revision": 1,
  "request_id": "demo-next-1",
  "kind": "REQUEST_TASK",
  "continuation_key": "demo-project/g1/document-1/r1/demo-submit-1/next-contract",
  "accepted_submission_request_id": "demo-submit-1",
  "accepted_artifact_version": "demo-report-v1",
  "remaining_goal": "另一个尚未验收的演示条件A2",
  "suggested_next_step": "请给出A2的有界合同",
  "question": "请ASSIGN下一合同或说明真实阻塞；当前没有新范围执行权限",
  "pending_handle": null
}
```

## 多岗位规划登记（非调度器）

当前schema2仍只承载单架构师/员工连接。规划新增岗位可在既有项目状态记录下表；它不执行路由、不自动建绑定，且不表示岗位已启动。

| 岗位 | 绑定引用 | 准确会话/方向证据 | 负责范围与资源 | 状态 |
|---|---|---|---|---|
| documentation-worker | 已有单岗位binding位置 | 由该binding对应实际证据提供 | 报告文件独占写入 | 以当前绑定实况为准 |
| recovery-worker | 未配置 | 未验证 | 环境/通信诊断，不能接管报告写入 | 候选，非ACTIVE |

若获准配置多个岗位，每个岗位引用自己的兼容绑定/真实端点，沿用其已有state-dir；公司表以稳定岗位标识映射任务责任和引用。不要复制旧绑定覆盖、用不同project_id绕过同目标归属或把一个会话同时映射多个独立岗位。新增会话/角色/授权按startup核实；无法支持并存时报告能力缺口。

跨岗位依赖以合同任务/修订记录，资源协调归属独立于传输锁；两个岗位想写同文件时仅已确认写入者可推进。自动选择员工、队列调度、全局排他和schema迁移尚未实现，需要后续功能变更。只读登记并不补齐这些能力。
