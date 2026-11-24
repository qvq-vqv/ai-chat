# 可复制的使用提示（v4）

以下提示发给已安装 ai-company 的主管 AI（推荐 Claude Code）。

## 一个功能：设计自己做，实现派出去

```text
用 ai-company。这个功能先由你（Opus）写详细设计，不要让员工起草设计。
设计确认后，把实现和测试作为一个任务派给员工，check 用完整测试命令，escalate: 1。
做完你亲自跑测试验收，再给我结论。
```

## 调研：只要事实

```text
用 ai-company 派一个 research 任务：收集 X 的竞品、价格和限制，每条附来源链接，输出到 research/x.md。
员工只整理事实，不下结论；结论由你读完后写。
```

## 多个方案挑一个

```text
我要 5 个标题候选。用 ai-company 让 2-3 个便宜席位各自独立写，不要用贵的席位。
你从中挑最好的 3 个并说明理由，不要改写它们的稿子。
```

## 画面类（网页、游戏、Blender）

```text
用 ai-company 派 game_visual 任务，quality: high。要求员工交活前用 ai-snap 截图自查，
check 里用 ai-snap blank 检查画面不是空白。最终截图由你亲自看，审美问题问我。
```

## 看进度、停任务

```bash
ai-status
```

```bash
ai-status open
```

停任务只在你明确要求时由 AI 执行：`ai-status stop <任务ID>`。
