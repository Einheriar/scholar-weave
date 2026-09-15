# TODO

> 临时任务清单。完成的事项移到「已完成」并注明日期；长期规划仍以 PLAN.md / HANDOFF.md 为准。

## 进行中

（无）

## 已完成

- [x] **手动深浅色模式切换**（2026-09-15）
  - 顶栏新增「切换深色 / 切换浅色」按钮（`src/components/ThemeToggle.tsx`），偏好存 `localStorage["theme"]`，刷新不闪烁（`layout.tsx` 内联脚本按 Next 16 官方 preventing-flash 指南实现）。
  - 移除了 `globals.css` 里脚手架遗留的 `prefers-color-scheme` 跟随逻辑，改为 `<html>.dark` class 驱动（Tailwind 4 `@custom-variant`）。
  - 所有面板组件（编辑器/侧栏/卡片/对话/修改集预览）补齐 `dark:` 变体；`color-scheme` 同步切换，表单控件与滚动条跟随。
  - 实现注记：主题状态用 `useSyncExternalStore` 订阅 class 变化，避免新版 `react-hooks/set-state-in-effect` 规则报错与 hydration 不匹配。
- [x] Windows 环境搭建：npmmirror 换源装依赖、build/typecheck/lint/Vitest(65)/Playwright(15) 全绿、`package:app` 打包验证（2026-09-15）
- [x] 修复 E2E 剪贴板用例在 Windows 上的 CRLF 平台差异（`tests/e2e/core-flow.spec.ts`，仅测试断言归一化，产品代码未动）（2026-09-15）
