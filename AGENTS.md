<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 交接文档只保留一份（HANDOFF）

项目根目录**只有 `HANDOFF.md` 一个交接文件**，它是唯一的交接真相来源。

- **不要新建** `HANDOFF-stageN.md`、`HANDOFF-<主题>.md` 之类的阶段分册——分册会各说各话、越积越多，接手的人不知道该信哪一份。
- 需要写新交接内容时，**直接改写 `HANDOFF.md`**（新内容覆盖/并入旧内容），不要另存新文件。
- 如果已经存在分册：把其中独有的信息**先合并进 `HANDOFF.md`**，确认没有信息丢失后**删掉分册**，并检查是否有其它文件引用它（引用也要一并改掉）。
- 分工：`PLAN.md` 放产品定义与计划，`HANDOFF.md` 只放当前进度、已验证的事实、接下来要做的事。
- 每次完成任务更新 `HANDOFF.md` 时，同步核对里面的数字（测试用例数、完成阶段表、关键文件地图）是否还准。
