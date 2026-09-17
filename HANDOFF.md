# 交接说明：正文撤销按钮视觉重做

更新时间：2026-09-17

## 当前任务

用户希望在正文卡片右上角增加一个显式的撤销按钮，位置已经认可：放在正文纸张内部右上角；鼠标悬停或键盘聚焦时提示 `撤销 / Ctrl+Z`。

目前已经做出一个功能完整的 demo，但用户明确否定了它的视觉设计：

> “这个按钮既没有‘按钮感’，也不优雅”

下一位 Agent 的首要任务是重新设计这个控件的视觉。不要为当前造型辩护，也不要只做微小修补；当前的小型幽灵图标按钮可以直接重新设计。目标是同时具备清楚但克制的按钮感，并与现有 Grammarly 式、浅色品牌绿界面协调。建议先在浏览器里观察现状，再和用户快速迭代视觉。功能语义和安全边界尽量保留。

## Git 基线

最近已提交的基线：

- `2585c9b 优化自动标题生成规则`
- `224d12a 优化顶栏布局并新增项目清空`
- `d27eaa0 优化宽屏历史栏标题对齐`

`2585c9b` 中的自动标题规则已经得到用户同意并提交：

- 手动标题优先。
- 英文等空格分词文本取前 12 个词。
- 中文等连续文本取前 24 个 Unicode 字符。
- 对异常超长单词保留 96 字符硬上限。
- 标题完全在本地派生，不调用 LLM。

不要回退这部分。

## 当前未提交改动

以下文件有未提交修改，主要属于撤销按钮 demo 及对应文档、测试：

- `src/components/editor/DocumentEditor.tsx`
- `tests/editor-batch-apply.test.tsx`
- `tests/e2e/core-flow.spec.ts`
- `DEVELOPMENTER.md`
- `README.md`
- `AGENTS.md`
- `plan/CHANGELOG.md`

撤销按钮 demo 尚未提交。用户当前只是要求交接，并未授权提交。

接手后请先执行：

```powershell
git status --short
git diff -- src/components/editor/DocumentEditor.tsx tests/editor-batch-apply.test.tsx tests/e2e/core-flow.spec.ts DEVELOPMENTER.md README.md AGENTS.md plan/CHANGELOG.md
```

如果环境提示 `dubious ownership`，只读检查可临时使用：

```powershell
git -c safe.directory=D:/cache/cache260914/superGrammarly status --short
```

不要为了这个提示擅自修改用户的全局 Git 配置。

## 已实现的撤销功能逻辑

`src/components/editor/DocumentEditor.tsx` 当前包含：

- 右上角 32px 撤销图标按钮，`aria-label="撤销正文编辑"`。
- tooltip 文案为 `撤销 / Ctrl+Z`。
- 没有可撤销编辑、只读状态时禁用。
- 用户输入后启用，点击调用 Tiptap `editor.commands.undo()`。
- `useEditor(options, [document.id])`：切换文档时重建编辑器，使撤销历史严格限定在当前文档、当前会话，避免跨文章撤销。
- `onTransaction` 同步 `canUndo`，`onCreate` 初始化为不可撤销。
- 正文右侧 padding 已增加，避免按钮覆盖文章文字。

安全撤销约束：

- 单条审阅建议的接受与撤销使用 `addToHistory: false`，避免浏览器原生撤销把正文退回、但审阅卡片仍显示“已接受”，造成状态分裂。
- ChangeSet／批量修改仍按既有事务进入历史，可作为整体撤销。
- 切换文章后不能撤销到上一篇文章。

这些逻辑是此前代码审查后与用户确认过的方向。重做视觉时，除非发现明确问题，不要破坏它们。

## 当前视觉为什么不合格

浏览器里的现状是一个非常轻、非常小的灰色撤销符号，靠禁用态／幽灵态存在于正文卡片右上角。它的问题不是位置，而是：

- 外形没有形成清晰的可点击区域，缺少按钮感。
- 视觉重量太轻，像漂浮的符号或状态图标。
- 与页面现有按钮的边框、圆角、层级和品牌色关系不够精致。
- 用户认为整体不优雅。

下一版可以重新考虑尺寸、轮廓、底色、悬停／按下反馈和禁用态，但应保持克制，不能抢正文。不要照搬顶栏的文字按钮；这是正文内的辅助操作，需要更紧凑。当前 CSS 类不是既定方案，可以替换。

## 已完成验证

在当前未提交实现上已通过：

- `npm test`：22 个测试文件、205 个测试全部通过。
- `npm run typecheck`。
- 相关 ESLint 检查。
- `npx playwright test tests/e2e/core-flow.spec.ts --project=chromium`：11/11 通过。
- `git diff --check`。

新增测试覆盖：

- 初始无历史时按钮禁用。
- 输入后按钮启用，tooltip 正确。
- 点击撤销恢复正文并重新禁用。
- 接受单条审阅建议不会污染原生撤销历史。

视觉重做后至少重跑相关编辑器测试、类型检查和 core-flow E2E。

## 浏览器状态

- `http://localhost:3000/` 正在运行。
- 内置浏览器标签页保持打开，用户此前明确说调用后不用关闭。
- 当前 demo 已在真实浏览器中检查过；功能正常，视觉被用户否定。

## 协作与提交约束

- 先给用户看新视觉，得到认可后再提交。
- 用户没有授权当前这次提交；不要自行 `git commit`。
- 不要覆盖或回滚与本任务无关的工作区改动。
- 继续遵守根目录 `AGENTS.md`，尤其是按钮可访问性、语义颜色、深色模式和 `prefers-reduced-motion` 约束。
