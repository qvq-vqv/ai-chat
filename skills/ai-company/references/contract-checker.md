# 可选只读合同检查器

在需要重复核对JSON附属工作记录时读取。采用[工作记录样例](work-records.md)的可选格式optional-work-records-v1；不是原生通信schema。纯文字合同仍用原核对清单，不要求为运行本工具重写旧记录或绑定。

在ai-company技能目录运行：

```sh
node scripts/contract-check.mjs --contract /absolute/project/contract.json
node scripts/contract-check.mjs --contract /absolute/project/contract.json --delivery /absolute/project/delivery.json --verdict /absolute/project/verdict.json
node --test scripts/contract-check.test.mjs
```

文件由任务原有授权创建，本工具仅只读显式文件，每个最多1MiB，拒绝末端软链接/非普通文件、未知/重复参数、坏JSON和过大输入。不给自动搜索目录、写入、修复、联网或执行Shell功能；JSON内的引用路径、URL、命令仅作为数据，不会访问。CLI输出stdout JSON，不写项目报告；外层另存输出时遵守项目权限。

退出码：0仅表示给定阶段的结构/关联无ERROR（仍可能有WARNING）；1为结构或关联错误；2为输入/参数错误。`STATIC_CHECK_OK`不是批准、ACCEPT或GOAL_COMPLETE。

## 输入格式

所有给定记录须有record_type、project_id、goal_revision（正整数）、task_id、revision（正整数）；额外字段保留为数据，但不自动校验其语义。

- **contract**：owner_role、authorization_reference、goal、report_to为非空文本；rule_baseline含id和非空modules文本列表；inputs非空，每项reference/version；acceptance非空，每项唯一id/criterion/evidence_required。allowed_actions、deliverables、stop_conditions非空文本列表；exclusions文本列表；resources列表每项reference/writer/baseline/release_condition，writer与合同owner_role一致；dependencies为列表。无文件资源时resources可为空。单个输入版本字符串不能证明实际使用全部输入。
- **delivery**（可省）：owner_role、rule_baseline_id、submission_request_id、artifact_version、decision_requested、next_suggestion；results、known_failures、not_verified、pending_operations均为列表。results每项唯一acceptance_id、合同列出的input_version、method/environment/observer/independence文本和result。PASS要求非空evidence引用；NOT_APPLICABLE要求reason范围说明。未覆盖合同全部条件时发INCOMPLETE_DELIVERY警告，可阶段部分交付。
- **verdict**（须给delivery）：submission_request_id、artifact_version、reviewer_role、review_method、next_action文本；review_results及limitations列表，review_results每项唯一acceptance_id/result，证据/不适用说明同上。decision沿用公司枚举。next_request_handle可省或为null/非空文本。ACCEPT须有accepted_scope；可选accepted_ids非空且唯一，用于逐项核对接受范围，所列项须有匹配PASS交付与审查。没有accepted_ids时警告范围不可结构化核对，不猜测自然语言。部分接受只列被接受项，不把剩余项当通过。

result允许PASS/FAIL/NOT_VERIFIED/NOT_APPLICABLE。授权引用、rule_baseline版本、evidence只核对结构和记录间关系，不核对真实性/可访问性/实际文件哈希。同名不同来源版本有歧义时由审查者补输入映射；本工具不推定独立性。

## 诊断处理

`INVALID_FIELD/INVALID_RECORD/INVALID_ROW`补格式；`IDENTITY_MISMATCH/RULE_BASELINE_MISMATCH/INPUT_VERSION_MISMATCH`核对原版本并保留旧提交；`DUPLICATE_ID/UNKNOWN_ACCEPTANCE/MISSING_EVIDENCE/MISSING_NA_REASON/REVIEW_WITHOUT_DELIVERY/ACCEPTED_ITEM_NOT_PASS`按字段位置核对证据及接受范围，不能自动变更裁决。

仅合同或无裁决时分别警告DELIVERY_NOT_PROVIDED/VERDICT_NOT_PROVIDED；SELF_REVIEW提示岗位相同，不能独立验收；GOAL_COMPLETE_NOT_PROVEN提示完整目标和安全收尾仍需原工作流验证。固定not_checked始终列出权限、实际证据、输入/规则哈希、质量、独立性、传输/在途及完整目标/安全收尾未检查。

本工具检查读取时的记录快照，不锁文件、自动裁决、强制去重或推定接收入口在线。出现诊断由原责任人按[合同](contracts.md)处理；发送未知继续原handle，不用本工具重发或释放锁。
