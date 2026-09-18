# TODO

> 临时任务清单。完成的事项移到「已完成」并注明日期。
> 长期规划以 [PLAN.md](./PLAN.md) 为准，变更记录见 [CHANGELOG.md](./CHANGELOG.md)；项目说明见 [README.md](../README.md)；
> 实现约定与踩坑记录见 [AGENTS.md](../AGENTS.md)。
> 临时任务里如果沉淀出「以后还得注意」的细节，请移到 AGENTS.md，别留在临时清单里。

## 进行中

- [ ] **历史记录抽屉的两处交互改进**（用户已提出，明确说"先不用做"，细节见 [HANDOFF.md](./HANDOFF.md) 第四节）
  - 待办 A：点抽屉外的遮罩也应能收起抽屉（现在只能按「关闭」或 Escape）
  - 待办 B：抽屉开合要有过渡动画（现状：进入动效方向不对——是通用"弹出"而非从左侧滑入；关闭时因条件渲染立即卸载，完全没有退出动画）
- [ ] **补充中文文档语言识别/选择**（当前产品以英文文档修改为主，暂不阻塞）
  - 前端目前固定发送 `language: "en"`；后续支持中文文档时，应根据正文检测语言或允许用户显式选择。
  - 审阅、对话和 ChangeSet 三条请求链路必须使用同一语言判断，避免 replacement 与原文语言不一致。

## 已完成

- [x] **全文上下文控制与修改集可见转场**（2026-09-18）
  - 聊天新增「包含全文｜总是」分段控件；默认仍要求选区／建议，全文模式允许创建 document
    节点，「总是」持久化默认值，完整选段自动附带全文且保留 range 锚点。
  - 每次发送从同一份最新正文快照计算 blocks、revision/checksum 与完整选段；提示词明确可见／
    可修改边界，服务端再过滤局部上下文的越界 edits。
  - 点击「预览修改」会暂时收起聊天并滚动保证修改集可见；接受、放弃、Escape 后恢复原状态，
    手动展开聊天等同放弃，修改集入口仍可再次打开。候选审阅意见的两步式流程保持不变。
  - 验证：Vitest 217 条、Playwright 44 条、typecheck、lint、production build 全部通过。

- [x] **左侧对话历史（ChatGPT 式）**（2026-09-15）
  - 新增 `Conversation` / `ChatTurn` schema（`src/lib/review-schema.ts`）、纯函数模块
    `src/lib/chat-history.ts`（标题派生 / 排序 / upsert / 相对时间）。
  - Dexie 库结构升到 v2 并新增 `conversations` 表；实例抽到 `src/lib/storage/db.ts`，
    文档与历史共用一个库，CRUD 分别在 `storage/documents.ts` / `storage/conversations.ts`。
  - `src/components/chat/ChatHistory.tsx`：宽屏（≥1280px）常驻左栏、窄屏汉堡抽屉（遮罩 + Escape）；
    随页面结构改为「历史栏 | (编辑器+对话 / 审阅侧栏)」。
  - 发送第一条消息时才创建记录，「清空对话」改为「新对话」（不丢已保存记录），单条可删除（带确认）；
    刷新后自动接上最近一条对话。新增 20 个 Vitest + 8 个 Playwright 用例。
  - 实测：长列表在 1920/1440/1366/1280 四种宽度 × 三种滚动位置下，与左下角浮动按钮零重叠。
- [x] **手动深浅色模式切换**（2026-09-15）
  - 顶栏新增「切换深色 / 切换浅色」按钮（`src/components/ThemeToggle.tsx`），偏好存 `localStorage["theme"]`，刷新不闪烁（`layout.tsx` 内联脚本按 Next 16 官方 preventing-flash 指南实现）。
  - 移除了 `globals.css` 里脚手架遗留的 `prefers-color-scheme` 跟随逻辑，改为 `<html>.dark` class 驱动（Tailwind 4 `@custom-variant`）。
  - 所有面板组件（编辑器/侧栏/卡片/对话/修改集预览）补齐 `dark:` 变体；`color-scheme` 同步切换，表单控件与滚动条跟随。
  - 实现注记：主题状态用 `useSyncExternalStore` 订阅 class 变化，避免新版 `react-hooks/set-state-in-effect` 规则报错与 hydration 不匹配。
- [x] Windows 环境搭建：npmmirror 换源装依赖、build/typecheck/lint/Vitest(65)/Playwright(15) 全绿、`package:app` 打包验证（2026-09-15）
- [x] 修复 E2E 剪贴板用例在 Windows 上的 CRLF 平台差异（`tests/e2e/core-flow.spec.ts`，仅测试断言归一化，产品代码未动）（2026-09-15）
