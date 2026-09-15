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

## 当前进度：阶段 0–6 全部完成 + 界面优化 + 界面美化

按 PLAN 第 14 节的阶段。已完成并**各自 commit**：

| 阶段 | 状态 | 说明 |
|------|------|------|
| 0 项目初始化 | ✅ | Next 16 脚手架、依赖、Vitest、typecheck/test/lint 脚本 |
| 1 编辑器与稳定段落 | ✅ | 文档模型、revision/checksum、BlockIdExtension、Dexie |
| 2 静态建议原型 | ✅ | 假数据、Decoration、双向定位、筛选、接受/忽略、过期 |
| 3 LLM 审阅 | ✅ | `/api/review`、provider adapter、防注入 prompt、真实 DeepSeek 验证 |
| 4 版本安全与批量修改 | ✅ | ChangeSet 预处理/重叠剔除/批量应用/撤销快照、ChangeSetPreview |
| 5 上下文聊天 | ✅ | `/api/chat`、`/api/change-set`、ContextChat、按意见生成修改集 |
| 6 产品化整理 | ✅ | Playwright E2E、键盘快捷键、无障碍收尾、README 部署说明 |
| 7 界面优化 | ✅ | 主题切换按钮（左下角浮动 SVG）、设置面板（中央模态）、数据 Tab |
| 8 界面美化 | ✅ | Grammarly 式绿色主调设计令牌、纸张式编辑器、胶囊筛选器、对话气泡、全局过渡动画 |
| 9 档位四档化 + 配置预设 | ✅ | 思考档位改 auto/off/low/high/max、模型配置可命名预设、修掉下拉被模态裁切 |

**质量基线（阶段 9 完成时）：85 个 Vitest 用例（12 文件）+ 15 个 Playwright 用例全过；`lint`（0 问题）/ `typecheck` / `build` 全通过。**

### 阶段 9：思考档位四档化 + 模型配置预设（已完成）

1. **思考档位砍成 4 档 + 关**（`src/lib/settings.ts`）：原 7 档（minimal/low/medium/high/xhigh/max/ultra）太多，改为
   `auto`（默认，不传参交给模型）/ `off`（不思考）/ `low` / `high` / `max`。old 7 档值迁移时统一落到 `auto`。
2. **协议层映射独立**（`src/lib/llm/thinking.ts`）：`resolveThinkingParam()` 把档位翻译成请求参数，服务端 provider 与前端共用，
   不再放在浏览器侧的 settings.ts 里。`auto` 不传参；`off` 传 `enable_thinking: false`（DeepSeek 风格端点）；
   `low/high/max` 作为 `reasoning_effort` 原样透传。**有意不做按模型能力的 clamp 映射表**：端点不支持就让 400 暴露给用户，
   比静默降级好。
3. **模型配置改成可命名预设**（`src/lib/settings.ts` + SettingsPanel 模型 Tab）：每个预设各自保存 apiKey/baseURL/model/档位，
   `activeId` 指向当前生效的。切换预设不再互相覆盖 Key（旧痛点是只有一份扁平配置，换提供商再切回来 Key 就丢了）。
   支持新建 / 重命名 / 删除（只剩 1 条时删除按钮 disabled）。默认预设：`默认配置` / DeepSeek 端点 / deepseek-chat / auto。
4. **旧数据自动迁移**：localStorage key 不变（`supergrammarly-settings`），读到旧扁平格式 `{apiKey,baseURL,model,reasoningEffort}`
   会包成单条预设并保留原值；`activeId` 非法兜底第一条；损坏 JSON 回落到 DEFAULT_SETTINGS。**用户升级不丢 Key。**
5. **API 请求体协议不变**：仍发扁平 `llmConfig {apiKey, baseURL?, model?, reasoningEffort}`，Zod schema 未动，
   服务端路由不需要任何改动。
6. **顺手修复：下拉被模态裁切**（`src/components/ui/select.tsx`）：自定义 Select 原来用绝对定位，在设置面板这个
   `overflow-y-auto` 滚动容器里会被裁掉——底部的「思考档位」5 个选项只能看到 1 个（实测 1000px 视口下仍被裁 132px）。
   改为 portal 挂到 body + `fixed` 定位，下方空间不足自动向上翻转，滚动/缩放时跟随。所有 4 处 Select 都已验证。

**测试**：新增 `tests/settings.test.ts`（迁移/预设/请求体 8 个）与 `tests/thinking.test.ts`（档位映射 + provider 请求体 12 个）。


### 阶段 8：界面美化（已完成）

1. **设计令牌**（`src/app/globals.css`）：Grammarly 式绿色主色（浅 `#0da678` / 深 `#2cc493`），页面底色暖白灰 `#f2f5f4`、深色墨绿黑 `#0e1311`（非纯黑，避免荧光感）。令牌：`surface`/`surface-muted`/`border`/`text-muted`/`text-faint`/`brand`/`brand-soft`/`brand-ring`，全部经 `@theme inline` 映射为 Tailwind 颜色类。
2. **统一按钮**（`src/components/ui/button.tsx`）：`buttonClass(variant, size)` 工厂，primary（绿底）/secondary（白底灰框）/danger（红）/ghost 四级，统一 `rounded-lg`、focus ring、`active:scale-[0.98]`。
3. **纸张式编辑器**：`DocumentEditor` 白色圆角卡片浮在页面底色上，内边距加大到 `px-8 py-7`，行高 1.8（`.ProseMirror` 排版规则）。
4. **侧栏**：范围筛选从下拉改为胶囊按钮组（全部/全文/段落/局部 + 计数徽标，选中绿底）；卡片选中态改为品牌绿描边 + 浅绿底；badge 全部 pill 化。
5. **对话气泡**：用户绿底右对齐（`rounded-br-sm`）、AI 浅灰左对齐（`rounded-bl-sm`），“正在思考”加三点跳动动画。
6. **设置面板**：模态淡入 + 面板弹入动画（`animate-modal-fade/pop`），Tab 激活指示条随选中滑动（`translateX` 过渡），输入框 focus 绿色 ring。
7. **过渡动画**：`body.theme-fade` 让主题切换时全局颜色 300ms 平滑过渡；列表条目/状态条 `animate-item-in` 淡入上移；全部尊重 `prefers-reduced-motion`。
8. **顺手修复**：
   - SettingsPanel 基线上的两个 lint 问题（未使用的 import、effect 内同步 setState → 改为渲染期 derived-state 模式）。
   - E2E `loadSample` helper 过时（阶段 7 把“载入样例”移进设置面板后测试没跟上，基线 8 个用例失败）——改为走 设置→数据 Tab→载入样例 流程，15 个用例恢复全绿。

**美化时的注意点（保留 HANDOFF 约束）：**
1. **保持功能不变** — 所有按钮、输入框、Tab 的功能和 aria-label 不要改
2. **保持数据结构不变** — localStorage key、Zod schema、API 路由不变
3. **保持可访问性** — 已有的 aria-label、role、键盘导航不要破坏
4. **深色模式适配** — 所有新样式都要有 dark: 变体（令牌已内置双套值，优先用语义令牌类如 `bg-surface`/`text-text-muted` 而非手写 neutral 色）

### 阶段 7：界面优化（已完成）

1. **主题切换按钮** ✅
   - 左下角浮动圆形按钮，太阳/月亮扁平 SVG 图标
   - 浅色模式显示太阳，深色模式显示月亮
   - 悬停提示"切换到深色模式"/"切换到浅色模式"
   - 位置在 Next.js Dev Tools 面板上方（`bottom: 16`）

2. **设置按钮** ✅
   - 齿轮图标，在主题切换按钮上方（`bottom: 28`）
   - 点击打开中央模态设置面板

3. **设置面板** ✅（`src/components/SettingsPanel.tsx`）
   - 中央模态窗口，支持 Esc 关闭、点击遮罩关闭、Cancel 按钮
   - **模型 Tab**：API Key、Base URL、Model、思考档位（阶段 7 时为 minimal/low/medium/high/xhigh/max/ultra，阶段 9 已改为 auto/off/low/high/max）
   - **审阅 Tab**：写作风格、保留术语、自定义指令（追加到系统提示末尾）
   - **数据 Tab**：载入样例、清空数据（从主界面移入）
   - 全部中文界面，localStorage 持久化

4. **用户配置支持** ✅
   - `src/lib/settings.ts` — 用户设置类型定义 + localStorage 读写
   - API 路由优先使用请求体里的用户配置，fallback 到 `.env.local`
   - DeepSeek `reasoning_effort` 参数透传（阶段 9 起 `off` 档改传 `enable_thinking: false`，映射见 `src/lib/llm/thinking.ts`）

### 界面美化（阶段 8 已完成）

上方“当前进度”表的阶段 8 记录了完整美化内容：绿色设计令牌、纸张式编辑器、胶囊筛选器、对话气泡、全局过渡动画，以及顺手修复的 lint/E2E 基线问题。

常用命令：
```bash
npm run dev        # 开发服务器（http://localhost:3000）
npm run test       # Vitest 全量
npm run test:e2e   # Playwright 全量（自动起 dev server）
npm run typecheck  # tsc --noEmit
npm run lint       # ESLint
npm run build      # 生产构建
```

## 已验证的事实（不要重复验证，可直接信）

- 真实 DeepSeek 端到端跑通：审阅返回三层建议、双向定位、单条接受改正文、对话生成修改集并预览接受。
- `.env.local` 已配好密钥（git 忽略），当前 `LLM_MODEL=deepseek-flash`。
- **DeepSeek 可用模型**：`deepseek-flash`、`deepseek-v4-pro`（**没有 `deepseek-v4-flash`**，用户最初给的名字不存在，已改用 `deepseek-flash`）。
- **`deepseek-flash` 是推理模型**，reasoning 会吃 token。`max_tokens` 必须给足（当前 `/api/review` 用 16000），否则 content 为空（`finish=length`）。这是之前排查出的真实坑。

## 阶段 6 完成情况（原剩余工作，均已落地）

1. **Playwright 正式 E2E 测试套件** ✅
   - `playwright.config.ts` + `tests/e2e/`，`npm run test:e2e`。15 个用例覆盖：
     首屏与三层建议分区、侧栏↔正文双向定位、单条接受/撤销逐字还原、过期建议不可执行、
     复制全文、Cmd/Ctrl+Enter 与 Cmd/Ctrl+Shift+C 快捷键、审阅成功/失败、
     对话纯解释与带修改集回复、批量接受后 Ctrl+Z 撤销。
   - 审阅/对话用例拦截 `/api/review`、`/api/chat` 用固定响应，**不需要 API Key、不消耗额度**。
   - 本机无头环境用系统 Chrome（`channel: "chrome"`），因为 Playwright 下载的 chromium
     构建所需系统依赖在本机不可用；`dev` 已配置 `allowedDevOrigins`，用例走 `localhost`。

2. **键盘快捷键** ✅（`src/app/page.tsx`）
   - Cmd/Ctrl+Enter 触发审阅（输入类控件聚焦时不拦截）；Cmd/Ctrl+Shift+C 复制全文。
   - 按钮加了 `title` 提示。批量/单条修改的撤销走编辑器自带 `Ctrl+Z`（StarterKit history）。

3. **无障碍收尾** ✅
   - 侧栏三区（全文审阅 / 段落意见 / 具体修改）始终作为 landmark 渲染，被筛选排除时显示空态。
   - 修改集预览：`role="dialog"` + `aria-labelledby`，打开时焦点进入面板、Esc 放弃、关闭后焦点还原。
   - 定位与审阅结果通过 `role="status" aria-live="polite"` 播报；点击侧栏卡片会选中正文对应范围。

4. **README 部署说明** ✅
   - 本地运行、`.env.local` 变量表（含 DeepSeek base URL 与可用模型）、生产构建/启动。
   - 明确：公网部署必须加身份验证 + 限流；密钥只在服务端；文档会发送给所配置的供应商。

5. **撤销的端到端确认** ✅
   - `tests/e2e/core-flow.spec.ts`「接受一条局部修改会改正文，撤销后逐字还原」在真实浏览器里
     断言接受→撤销后整篇段落文本与操作前**逐段相等**（`toEqual`）。
   - `tests/e2e/review-chat.spec.ts`「批量接受修改集后可用 Ctrl+Z 撤销回原文」覆盖批量撤销。

### 已知的取舍 / 后续可做

- 批量接受 ChangeSet 目前依赖编辑器 history 撤销（Ctrl+Z），没有像单条那样在卡片上提供“撤销本次修改”的独立按钮。PLAN 5.1 只要求单条可撤销，故未扩 scope。
- E2E 强依赖内置样例文本片段（mock 从请求体按文本反查 blockId），改动 `sample-data.ts` 的措辞时需同步更新 `tests/e2e/helpers.ts`。

### ⚠️ 安全注意：用户配置的 API Key 以明文存储在 localStorage

设置面板允许用户在前端配置自己的 API Key / Base URL / Model / 思考档位（`src/lib/settings.ts`，持久化到 `localStorage["supergrammarly-settings"]`）。**阶段 9 起配置按「命名预设」组织**：用户可能同一提供商有多个 Key，每条预设各自保存 Key/地址/模型/档位，切换预设不会互相覆盖。

**当前状态（本地项目，可接受）：**
- Key 明文存在浏览器 localStorage，任何能打开 DevTools 的人都能看到。
- 适用于个人本地使用，不上公网。

**如果要部署到公网，必须先解决：**
1. **不要允许用户在前端输入 API Key** — 改为只在服务端 `.env.local` 配置，前端设置面板隐藏 Model Tab 或改为只读展示。
2. 如果必须支持用户自带 Key → 需要 Web Crypto 加密存储（PBKDF2 派生 + AES-GCM），或改为后端托管密钥。
3. 公网部署必须加身份验证 + 限流（README 部署说明里已强调）。

相关代码：
- `src/lib/settings.ts` — 明文 localStorage 存储
- `src/components/SettingsPanel.tsx` — 设置面板 UI
- `src/app/api/review/route.ts` — 优先使用请求体里的用户配置，fallback 到 env

## 不要做的事（PLAN 明确的非 MVP 范围）

登录/付费/多用户、多人协作、Word/PDF 富文本无损导入导出、浏览器扩展、Office Add-in、原生移动应用、离线本地模型管理、自动后台改写、完整版本控制。桌面封装（Tauri）等演进方向见 PLAN 第 18 节，MVP 验证前不做。

## 关键文件地图

```
src/lib/review-schema.ts        # Zod 协议唯一来源（Document/ReviewItem/ChangeSet/ChatContext）
src/lib/revisions.ts            # 稳定 block ID + revision/checksum
src/lib/anchoring.ts            # 锚点定位（不信坐标，locateInText/locateRange）
src/lib/changeset.ts            # ChangeSet 预处理/重叠剔除/批量应用/撤销快照
src/lib/sample-data.ts          # 阶段 2 假数据（deception 引言 + 10 条建议）
src/lib/settings.ts             # 用户设置（LLM 命名预设 + 审阅偏好）+ localStorage 持久化 + 旧格式迁移
src/lib/llm/thinking.ts         # 思考档位 → 请求参数映射（服务端与前端共用）
src/lib/storage/documents.ts    # Dexie 持久化（含 clearAllDocuments）
src/lib/llm/                    # provider adapter、prompts（审阅+对话）、wire schema、server-helpers
src/components/editor/          # DocumentEditor、BlockIdExtension、ReviewDecorationExtension
src/components/review/          # ReviewSidebar、ReviewCard、ChangeSetPreview、review-meta
src/components/chat/            # ContextChat
src/components/ThemeToggle.tsx  # 主题切换按钮（左下角浮动）
src/components/SettingsPanel.tsx # 设置面板（中央模态，模型/审阅/数据三个 Tab）
src/app/api/{review,chat,change-set}/route.ts
src/app/page.tsx                # 主界面，所有状态与接线都在这里
tests/                          # 85 个 Vitest 用例（单元 + 编辑器集成 + API mock），12 个文件
tests/e2e/                      # 15 个 Playwright 用例（config 在根目录 playwright.config.ts）
```

## 给接手 agent 的启动指令（可直接用）

```
请先读 PLAN.md 和 HANDOFF.md，了解项目目标与当前进度。这是一个 Next.js 16 + Tiptap 3 的
AI 文档审阅工具，阶段 0-8 已全部完成，阶段 9（思考档位四档化 + 模型配置预设）刚完成：
档位改为 auto/off/low/high/max，LLM 配置按命名预设组织（切换不丢 Key），并修掉了
设置面板里下拉被模态裁切的问题。85 个 Vitest 用例与 15 个 Playwright 用例全过。
修改前先跑 npm run test 与 npm run test:e2e 确认基线是绿的；每完成一项跑
npm run typecheck / lint / test，并按阶段 commit。不要扩张到非 MVP 范围。
```

## 给后续界面工作的提示

界面已完成 Grammarly 式美化（阶段 8）。继续迭代时请注意：
1. **保持功能不变** — 所有按钮、输入框、Tab 的功能和 aria-label 不要改
2. **保持数据结构不变** — localStorage key、Zod schema、API 路由不变
3. **保持可访问性** — 已有的 aria-label、role、键盘导航不要破坏
4. **用语义令牌** — 颜色优先用 `bg-surface`/`bg-brand`/`text-text-muted`/`border-border` 等
   （globals.css 的 @theme 映射，自带深浅双套值），不要再手写 neutral/blue 色值
5. **动画** — 复用 `animate-item-in`/`animate-modal-fade`/`animate-modal-pop`，
   并保证 `prefers-reduced-motion` 下可用
