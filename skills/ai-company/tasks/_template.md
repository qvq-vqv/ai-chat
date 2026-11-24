---
worker: auto             # auto (router picks) | agy | codebuddy | codex
category: code           # code review design writing_zh writing_en marketing research simple vision image_gen video_gen
quality: normal          # draft | normal | high | critical
workdir:                 # empty = project root when the task is in <project>/.ai-tasks/
model:                   # optional, empty = worker default
timeout: 1800            # seconds
check:                   # optional shell command run in workdir after the worker; exit 0 = pass (e.g. python3 -m pytest -q)
escalate: 0              # 1 = if check fails, retry once with a stronger seat (needs worker: auto + check)
sandbox:                 # optional: os = run codex in the dispatcher's own sandbox (needed e.g. for xcodebuild)
---

## Goal
<one or two sentences: what should exist / work when done>

## Context
<files to read first, decisions already made, links to the design/spec inside workdir.
 The worker sees nothing of our conversation — everything it needs must be here or in the files.>

## Scope
- In: <what to do>
- Out: <what NOT to do / not touch — prevents scope creep and duplicate work>

## Output
<exact files / format to produce, e.g. `src/fish.ts` + `tests/fish.test.ts`; or a markdown file with sections X, Y>

## Acceptance criteria (= when to stop)
- [ ] <checkable item, e.g. `npm test` passes — the full suite, not a sample>
- [ ] <negative case that must fail / be rejected>
- [ ] Stop when all items pass; if one cannot pass, stop and explain instead of looping.

## Report
End with a short summary: files changed, how you verified, open issues.
