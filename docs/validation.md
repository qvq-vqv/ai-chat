# v4.0.0-beta.1 发行验证范围

2026-11-23，macOS（Apple Silicon）、Node 25、Python 3 本地运行：

| 检查 | 结果 |
|---|---|
| `npm run check`（ai-chat 语法 + ai-company 的 py_compile / bash -n） | 通过 |
| `scripts/test_ai_company.py`（8 项：配置一致、路由、拒绝危险目录、错误 frontmatter、安装不覆盖） | 全部通过 |
| 发行工具测试（`scripts/test_distribution.py`，16 项） | 全部通过 |
| ai-chat 原测试（116 项） | 76 通过、40 失败，与 v3.1 相同；失败全部在暂停的实验 resident 模块，本版未修改、未隐藏 |

ai-company 离线测试不调用任何员工 CLI、账号或网络。安装测试只在 macOS 运行，其他系统自动跳过。

真实使用证据来自维护者自己的 Mac：截至 2026-11-23 派出 107 个任务（agy 47、codebuddy 56、codex 4）。这证明工具在该环境可用，不能代表你的账号、模型版本和额度规则也一样；请先派一个小任务自测。

`npm test` 保留完整失败语义，会因上述 40 项实验测试返回非零，CI 不会伪装成全绿。
