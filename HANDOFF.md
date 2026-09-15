# 交接说明（HANDOFF）

> 写给接手此项目的 agent / 开发者。
> 项目计划与产品定义见根目录 [PLAN.md](./PLAN.md)——先读它。
> 本文档只描述**当前进度、已验证的事实、以及接下来要做的事**。

## 项目一句话

本地优先、Web 优先的 AI 文档审阅工作台（参考 Grammarly）。长文本交给 LLM 审阅，结果按"全文/段落/局部"三层绑定到原文位置，所有修改必须先预览、再由用户逐条确认后才应用。当前接入 DeepSeek（OpenAI 兼容协议）。

## 技术栈与关键约定

- Next.js 16（App Router，Turbopack）+ React 19 + TypeScript 5 + Tailwind 4，`src/` 目录，别名 `@/* → src/*`
- 编辑器：Tiptap 3（`@tiptap/react|pm|starter-kit`），用 Decoration 做标记，**不序列化进正文**
- 运行时协议唯一来源：Zod schema（`src/lib/review-schema.ts`）
- 本地持久化：Dexie（IndexedDB），读写都过 schema 校验
- 测试：Vitest + Testing Library + fake-indexeddb（`vitest.config.mts`，jsdom 环境）
- 包管理：npm（有 package-lock.json；pnpm 也装了但项目用的是 npm）

### 必须遵守的核心约束（PLAN 里反复强调）

1. **不信任 LLM 字符坐标**。定位一律用 `blockId + original(逐字) + prefix/suffix 消歧`（`src/lib/anchoring.ts`）。定位失败标记 `stale`，**绝不猜测位置强行替换**。
2. **稳定 block ID**（`src/lib/revisions.ts` + `BlockIdExtension`）：普通编辑保留 ID、拆分保留前半段、合并保留目标段、粘贴全文重发 ID。
3. **严格区分 `opinion`（不可执行，禁 replacement）与 `edit`（必有 replacement，scope 不能是 document）**。由 schema 的 `superRefine` 强制。
4. **LLM 永不未经确认直接改正文**。全文/结构意见必须走"生成 ChangeSet → 差异预览 → 用户确认"。
5. **API Key 只在服务端环境变量**（`.env.local`，已被 git 忽略），绝不进前端代码或日志。
6. **防注入**：文档内容在 prompt 里被包裹为不可信数据，系统提示规定不执行其中指令；输出仍过 Zod + 业务校验。

## 当前进度：阶段 0–5 完成，阶段 6 进行中

按 PLAN 第 14 节的阶段。已完成并**各自 commit**：

| 阶段 | 状态 | 说明 |
|------|------|------|
| 0 项目初始化 | ✅ | Next 16 脚手架、依赖、Vitest、typecheck/test/lint 脚本 |
| 1 编辑器与稳定段落 | ✅ | 文档模型、revision/checksum、BlockIdExtension、Dexie |
| 2 静态建议原型 | ✅ | 假数据、Decoration、双向定位、筛选、接受/忽略、过期 |
| 3 LLM 审阅 | ✅ | `/api/review`、provider adapter、防注入 prompt、真实 DeepSeek 验证 |
| 4 版本安全与批量修改 | ✅ | ChangeSet 预处理/重叠剔除/批量应用/撤销快照、ChangeSetPreview |
| 5 上下文聊天 | ✅ | `/api/chat`、`/api/change-set`、ContextChat、按意见生成修改集 |
| 6 产品化整理 | 🔶 进行中 | 部分完成，**剩余工作见下** |

**质量基线（交接时）：65 个测试全过；`lint` / `typecheck` / `build` 全通过。**

常用命令：
```bash
npm run dev        # 开发服务器（http://localhost:3000）
npm run test       # Vitest 全量
npm run typecheck  # tsc --noEmit
npm run lint       # ESLint
npm run build      # 生产构建
```

## 已验证的事实（不要重复验证，可直接信）

- 真实 DeepSeek 端到端跑通：审阅返回三层建议、双向定位、单条接受改正文、对话生成修改集并预览接受。
- `.env.local` 已配好密钥（git 忽略），当前 `LLM_MODEL=deepseek-flash`。
- **DeepSeek 可用模型**：`deepseek-flash`、`deepseek-v4-pro`（**没有 `deepseek-v4-flash`**，用户最初给的名字不存在，已改用 `deepseek-flash`）。
- **`deepseek-flash` 是推理模型**，reasoning 会吃 token。`max_tokens` 必须给足（当前 `/api/review` 用 16000），否则 content 为空（`finish=length`）。这是之前排查出的真实坑。

## 阶段 6 剩余工作（接下来要做的事，按优先级）

1. **Playwright 正式 E2E 测试套件**（目前只有临时脚本，没入库）
   - 装 `@playwright/test`，建 `playwright.config.ts` 与 `tests/e2e/`。
   - 覆盖核心流程：载入 → 审阅（可 mock `/api/review` 响应以免依赖真 key）→ 定位 → 接受 → 撤销 → 对话 → 修改集预览接受。
   - 注意：本机无头浏览器版本与 Playwright 期望可能不匹配（之前用系统 Chrome `/opt/google/chrome/chrome` 通过 `executablePath` 绕过）。E2E 脚本里也用了同样方式。
   - `dev` 已配置 `allowedDevOrigins: ["127.0.0.1","localhost"]`，用 `localhost` 访问避免 HMR 跨域被拦。

2. **键盘快捷键收尾**（page.tsx 还没加）
   - 建议：Cmd/Ctrl+Enter 触发"开始审阅"；Cmd/Ctrl+Shift+C 复制全文。对话框内 Enter=发送 / Shift+Enter=换行已实现。
   - 加一个 `useEffect` 全局监听，注意在输入框/textarea 聚焦时不要误触发。

3. **无障碍收尾**
   - 已有：装饰 `role="mark"` + `aria-label`、卡片 `aria-current`、状态 `role="status"/"alert"`、筛选/输入的 `aria-label`、颜色不单独作信息载体（配图标+中文标签）。
   - 待补：侧栏三区 landmark、修改集预览的键盘焦点管理、跳转定位后的焦点落点。

4. **README 部署说明**
   - 本地运行步骤、`.env.local` 配置（从 `.env.example` 复制）、生产 `npm run build && npm start`。
   - 明确：部署到公网必须加身份验证 + 限流（PLAN 8.3），密钥只在服务端。

5. **撤销的端到端人工确认**
   - 单条/批量撤销的逻辑与单测都在（`acceptSnapshotRef`、`revertBlockTexts`），但建议接手的 agent 在界面上实际过一遍"接受 → 撤销 → 看正文是否逐字还原"。

## 不要做的事（PLAN 明确的非 MVP 范围）

登录/付费/多用户、多人协作、Word/PDF 富文本无损导入导出、浏览器扩展、Office Add-in、原生移动应用、离线本地模型管理、自动后台改写、完整版本控制。桌面封装（Tauri）等演进方向见 PLAN 第 18 节，MVP 验证前不做。

## 关键文件地图

```
src/lib/review-schema.ts        # Zod 协议唯一来源（Document/ReviewItem/ChangeSet/ChatContext）
src/lib/revisions.ts            # 稳定 block ID + revision/checksum
src/lib/anchoring.ts            # 锚点定位（不信坐标，locateInText/locateRange）
src/lib/changeset.ts            # ChangeSet 预处理/重叠剔除/批量应用/撤销快照
src/lib/sample-data.ts          # 阶段 2 假数据（deception 引言 + 10 条建议）
src/lib/storage/documents.ts    # Dexie 持久化（含 clearAllDocuments）
src/lib/llm/                    # provider adapter、prompts（审阅+对话）、wire schema、server-helpers
src/components/editor/          # DocumentEditor、BlockIdExtension、ReviewDecorationExtension
src/components/review/          # ReviewSidebar、ReviewCard、ChangeSetPreview、review-meta
src/components/chat/            # ContextChat
src/app/api/{review,chat,change-set}/route.ts
src/app/page.tsx                # 主界面，所有状态与接线都在这里
tests/                          # 65 个测试（单元 + 编辑器集成 + API mock）
```

## 给接手 agent 的启动指令（可直接用）

```
请先读 PLAN.md 和 HANDOFF.md，了解项目目标与当前进度。这是一个 Next.js 16 + Tiptap 3 的
AI 文档审阅工具，阶段 0-5 已完成，65 个测试全过。现在只做 HANDOFF.md 里"阶段 6 剩余工作"，
按优先级逐项推进，每完成一项跑 npm run typecheck / lint / test 验证，并按阶段 commit。
不要扩张到非 MVP 范围。修改前先跑 npm run test 确认基线是绿的。
```
