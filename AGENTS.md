<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 项目约定（AGENTS.md）

本文件是**永久性**的项目约定、实现约束与踩坑记录，面向在本仓库工作的 agent / 开发者。
**做这个项目时发现的、以后还需要注意的细节，都写到这里**，不要留在临时的交接文件里。

## 文档分工（写内容前先看这一节）

| 文件 | 性质 | 放什么 |
|------|------|--------|
| `HANDOFF.md` | **临时** | 只在需要别的 agent 接手时存在：当前进度、本机环境、下一步。工作交接完就可以被覆盖或删掉 |
| `AGENTS.md`（本文件） | **永久** | 整体注意事项、实现约定、踩过的坑、有意为之的取舍 |
| `README.md` | **永久** | 项目是什么、怎么跑、怎么打包部署、隐私与数据发送（写给使用者与新加入的人） |
| `PLAN.md` | **永久** | 产品定义与原始实施计划，只在需求层面变更时才改 |
| `TODO.md` | 临时 | 短期任务清单 |

规则：

- **不要新建 `HANDOFF-stageN.md` / `HANDOFF-<主题>.md` 这类分册。** 交接内容直接改写 `HANDOFF.md`。已有分册要先把独有信息合并进去、确认无丢失、再删除，并检查有无别处引用它。
- 长期有效的知识**不要**留在 `HANDOFF.md`；`HANDOFF.md` 变长说明有内容放错了位置。
- 更新文档时同步核对里面的数字（测试用例数、完成阶段、关键文件地图）是否还准。

## 技术栈与关键约定

- Next.js 16（App Router，Turbopack）+ React 19 + TypeScript 5 + Tailwind 4；`src/` 目录，别名 `@/* → src/*`
- 编辑器：Tiptap 3（`@tiptap/react|pm|starter-kit`）。建议标记用 Decoration **渲染出来，不序列化进正文**
- 运行时协议唯一来源：Zod schema（`src/lib/review-schema.ts`），前后端共用
- 本地持久化：Dexie（IndexedDB），读写都过 schema 校验
- 测试：Vitest + Testing Library + fake-indexeddb（`vitest.config.mts`，jsdom）；E2E 用 Playwright（`playwright.config.ts`）
- 测试只覆盖自然段纯文本，编辑相关的 PM 位置计算改动后务必跑 `tests/editor-batch-apply.test.tsx`
- 包管理：npm（有 `package-lock.json`）

## 必须遵守的核心约束（实现时不要破坏）

1. **不信任 LLM 字符坐标**：定位一律用 `blockId + 逐字 original + prefix/suffix` 消歧（`src/lib/anchoring.ts`）。定位失败标记 `stale`，**绝不猜测位置强行替换**。
2. **稳定 block ID**（`src/lib/revisions.ts` + `BlockIdExtension`）：普通编辑保留 ID、拆分保留前半段、合并保留目标段、粘贴全文重发 ID。
3. **严格区分 `opinion` 与 `edit`**：`opinion` 不可执行且禁带 `replacement`；`edit` 必有 `replacement` 且 scope 不能是 `document`。由 schema 的 `superRefine` 强制。
4. **LLM 永不未经确认改正文**：全文/结构意见必须走「生成 ChangeSet → 差异预览 → 用户确认」。
5. **API Key 只在服务端环境变量**（`.env.local`，已 git 忽略），绝不进前端 bundle、不进日志、不进 git；用户自带 Key 只存在浏览器 localStorage（见下「安全注意」）。
6. **防注入**：文档内容在 prompt 里被包裹为不可信数据，系统提示规定不执行其中指令；输出仍须过 Zod + 业务校验。

## 关键文件地图

```
src/lib/review-schema.ts        # Zod 协议唯一来源（Document/ReviewItem/ChangeSet/ChatContext）
src/lib/revisions.ts            # 稳定 block ID + revision/checksum
src/lib/anchoring.ts            # 锚点定位（不信坐标，locateInText/locateRange）
src/lib/changeset.ts            # ChangeSet 预处理/重叠剔除/批量应用/撤销快照
src/lib/tiptap-convert.ts       # DocumentState ↔ ProseMirror JSON 互转
src/lib/sample-data.ts          # 内置样例文档 + 10 条假建议（E2E 依赖其措辞）
src/lib/settings.ts             # 用户设置（LLM 命名预设 + 审阅偏好）+ localStorage 持久化 + 旧格式迁移
src/lib/storage/documents.ts    # Dexie 持久化（含 clearAllDocuments）
src/lib/llm/thinking.ts         # 思考档位 → 请求参数映射（服务端与前端共用）
src/lib/llm/                    # provider adapter、prompts（审阅+对话）、wire schema、server-helpers
src/components/editor/          # DocumentEditor、BlockIdExtension、ReviewDecorationExtension
src/components/review/          # ReviewSidebar、ReviewCard、ChangeSetPreview、review-meta
src/components/chat/            # ContextChat
src/components/ui/              # button.tsx（buttonClass 工厂）、select.tsx（自定义下拉）
src/components/ThemeToggle.tsx  # 主题切换按钮（左下角浮动）
src/components/SettingsPanel.tsx # 设置面板（中央模态，模型/审阅/数据三个 Tab）
src/app/api/{review,chat,change-set}/route.ts
src/app/page.tsx                # 主界面，所有状态与接线都在这里
src/app/globals.css             # 设计令牌（@theme inline）与全局动画
scripts/package.mjs             # 打包成可双击启动的本地应用
tests/                          # Vitest 用例（单元 + 编辑器集成 + API mock）
tests/e2e/                      # Playwright 用例（helpers.ts 里是 mock 与共用操作）
```

## 界面开发约定

界面已完成 Grammarly 式美化。继续迭代时：

1. **保持功能不变** — 所有按钮、输入框、Tab 的功能与 `aria-label` 不要改
2. **保持数据结构不变** — localStorage key（`supergrammarly-settings` / `theme`）、Zod schema、API 路由协议不变
3. **保持可访问性** — 已有的 `aria-label`、`role`、键盘导航、`aria-live` 播报不要破坏
4. **用语义令牌** — 颜色优先 `bg-surface` / `bg-surface-muted` / `bg-brand` / `text-text-muted` / `text-text-faint` / `border-border` 等（`globals.css` 的 `@theme inline` 映射，自带深浅双套值），不要手写 neutral/blue 色值
5. **深色模式** — 新样式都要有 `dark:` 变体；令牌已内置双套值，用语义令牌即可自动适配
6. **动画** — 复用 `animate-item-in` / `animate-modal-fade` / `animate-modal-pop`，并保证 `prefers-reduced-motion` 下可用

## 已知陷阱（已经踩过，不要再踩）

1. **`Select` 的浮层是 portal 到 `body` 的。** 设置面板正文是 `overflow-y-auto`，绝对定位的下拉会被裁掉（实测 1280×720 下 170px 的面板只露出 38px）。所以改成了 portal + `fixed` + 下方空间不足自动上翻 + 滚动/缩放跟随。写测试或用 Playwright 找下拉时：`getByRole("listbox")` / `getByRole("option")` 必须从**根**找，**不要 scope 到 `getByRole("dialog")`**（那样 count 是 0）；触发器 `button[aria-label="..."]` 仍在原位，可以正常 scope。
2. **`<main>` 的 `w-full` 不能删**（`src/app/page.tsx`）。`body` 是 `flex flex-col`，而 `<main>` 带 `mx-auto max-w-7xl`：flex 子项在**交叉轴**上一旦有 `auto` 外边距，就不再被 `align-items: stretch` 撑开，而是按 fit-content 定宽——整页宽度于是由内容决定，正文短或刚清空时整页缩窄（1440 视口下 `main` 只有 1029px），正文长时才撑满 1280px。表现是「同一窗口宽度下输入框宽度却在变」，**与滚动条无关**。
3. **`deepseek-flash` 是推理模型，reasoning 会吃 token。** `max_tokens` 必须给足（`/api/review` 当前 16000），否则返回的 `content` 为空、`finish=length`。
4. **新克隆 / 解压源码后先跑一次 `npm run build` 或 `npm run dev`。** Next 在构建时生成 `next-env.d.ts` 与 `.next/types/`，它们被 git 忽略、不在源码包里；缺了它们 `npm run typecheck` 会报 `Cannot find name 'LayoutProps'`——那是缺生成物，不是代码有问题。
5. **E2E 用系统安装的 Google Chrome**（`channel: "chrome"`），不是 Playwright 下载的 chromium——本机缺少后者所需的系统依赖。换环境可 `npx playwright install --with-deps chromium` 后改回默认浏览器。
6. **E2E 强依赖内置样例文本片段**：mock 从请求体按文本反查 `blockId`。改动 `src/lib/sample-data.ts` 的措辞时，必须同步更新 `tests/e2e/helpers.ts`。
7. **React 19 的 lint 规则 `react-hooks/set-state-in-effect` 会报「effect 内同步 setState」。** 用渲染期 derived-state 模式，或用 `useSyncExternalStore` 订阅外部状态（主题切换就是这么做的，同时避免 hydration 不匹配）。

## 有意为之的取舍（不要当 bug 改掉）

- **不做按模型能力的档位 clamp 映射表**：思考档位（`auto`/`off`/`low`/`high`/`max`）里端点不支持的档位就直接让它 400 报错给用户，比静默降级更好。将来真要做映射表再加。
- **代理（Zero Omega 之类）不需要处理**：LLM 请求由 Next.js 服务端 `fetch` 发出，不经过浏览器，浏览器代理插件只影响用户访问页面本身。服务端若要走代理得设 `HTTPS_PROXY`（Node 原生 `fetch` 不自动读，需要 undici 的 `EnvHttpProxyAgent` 之类）。
- **批量接受 ChangeSet 依赖编辑器自带的 `Ctrl+Z`**，没有像单条那样提供「撤销本次修改」的独立按钮。PLAN 5.1 只要求单条可撤销。
- **档位只保留 5 个（`auto`/`off`/`low`/`high`/`max`），不要再扩档**：`low/high/max` 是与 Kimi K3、DeepSeek 原生档位对齐的公约数。

## ⚠️ 安全注意：用户配置的 API Key 明文存在 localStorage

设置面板允许用户在前端配置 API Key / Base URL / Model / 思考档位（`src/lib/settings.ts`，持久化到 `localStorage["supergrammarly-settings"]`），并按「命名预设」组织——一个提供商可以有多个 Key，每条预设各存 Key/地址/模型/档位，切换预设不互相覆盖。

**当前状态（本地项目，可接受）：** Key 明文存在浏览器 localStorage，任何能打开 DevTools 的人都能看到；仅适用于个人本地使用，不要直接上公网。

**部署到公网前必须先解决：**

1. **不要允许用户在前端输入 API Key** — 改为只在服务端 `.env.local` 配置，前端设置面板隐藏 Model Tab 或改为只读展示。
2. 若必须支持用户自带 Key → 需要 Web Crypto 加密存储（PBKDF2 派生 + AES-GCM），或改为后端托管密钥。
3. 公网部署还必须加身份验证 + 限流（README 部署说明里已强调），否则任何人都能消耗你的额度。

相关代码：`src/lib/settings.ts`、`src/components/SettingsPanel.tsx`、`src/app/api/review/route.ts`（优先用请求体里的用户配置，fallback 到 env）。

## 不要做的事（PLAN 明确的非 MVP 范围）

登录/付费/多用户、多人协作、Word/PDF 富文本无损导入导出、浏览器扩展、Office Add-in、原生移动应用、离线本地模型管理、自动后台改写、完整版本控制。桌面封装（Tauri）等演进方向见 PLAN 第 18 节，MVP 验证前不做。

## 常用命令

```bash
npm run dev         # 开发服务器（http://localhost:3000）
npm run typecheck   # tsc --noEmit
npm run lint        # ESLint
npm run test        # Vitest（单元/集成）
npm run test:e2e    # Playwright（自动起 dev server）
npm run build       # 生产构建
npm start           # 启动生产服务器
npm run package:app # 打包成可双击启动的本地应用（见 README）
```

每完成一项改动，跑 `typecheck` / `lint` / `test`，必要时加 `test:e2e`；按阶段 commit。
