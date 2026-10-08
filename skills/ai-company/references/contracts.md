# 合同、请求与验收

每轮请求包含 project_id、goal_revision、task_id、revision、request_id、kind 和具体判断问题。kind 可为 REQUEST_TASK、ASK_DECISION、SUBMIT_DELIVERY、REPORT_BLOCKER。传输适配器负责请求关联；员工不能靠姓名、模型品牌或最近回复认领结果。

架构师回复 response.decision 和 response.reply；由目标适配器映射到其原生协议。决策枚举：ASSIGN、ACCEPT、REVISE、ANSWER、NEED_USER、BLOCKED、GOAL_COMPLETE。Codex 适配器保留原有 codex-bridge-response 信封，通用层不要求其他软件解析 Codex 本地存储。

ASSIGN 合同至少说明：任务目标、输入与基线、允许改动、交付物、验收标准、排除项与停止条件。依赖未就绪的下一任务先留本地。同一任务只有一个员工负责推进，日常已批准步骤无需逐文件求批。

SUBMIT_DELIVERY 包含变更摘要、输入版本、测试方法与原始证据、已知限制。证据位置根据接收端实测能力选择：同机共享路径、可访问链接或最小必要正文。不得默认所有模型都有项目文件或测试执行权限。

ACCEPT 只接受当前阶段，保留通过的部分；REVISE 指出具体缺陷和补充证据。GOAL_COMPLETE 必须逐项对应完整验收标准，用户需要评价的部分不能由架构师代替通过。NEED_USER 集中列出真实决策问题，正常授权内执行不反复打断。

规划、施工和验收职责可在同软件内由不同会话承担，但不能把同一个员工的自述包装成独立验收。验收能力不足时向用户报告证据缺口或申请明确验证工具，不自行扩大资源权限。
