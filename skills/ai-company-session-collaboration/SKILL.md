---
name: ai-company-session-collaboration
description: 旧 AI 公司会话协作入口，转到 ai-company 一键启动与模型无关的角色协作流程；保留已有项目绑定、授权和待回复请求。
---

# AI 公司旧入口兼容

本入口保留，完整规则迁移到 [AI 公司一键启动](../ai-company/SKILL.md)。使用时读取新版入口；旧配置按其运行规范迁移，保留原授权和状态目录，先恢复未完成请求，不重新发送初始化消息。

旧 Antigravity → Codex 链路仍使用 ai-chat 的 Codex 适配器；新增软件根据真实适配能力接入，不把迁移当作已连接或新授权。旧技术资料保留在 references/。
