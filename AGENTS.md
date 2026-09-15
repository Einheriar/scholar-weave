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
| `plan/PLAN.md` | **永久** | 产品定义与原始实施计划，只在需求层面变更时才改 |
| `plan/CHANGELOG.md` | **永久** | 变更记录，条目对应 git 提交、按里程碑分组 |
| `TODO.md` | 临时 | 短期任务清单 |

`plan/` 目录专放**计划与变更记录**这两类文档；新的计划类文档、以及每个里程碑的变更记录都放这里。引用时用相对路径（`plan/PLAN.md`、`plan/CHANGELOG.md`）。

规则：

- **不要新建 `HANDOFF-stageN.md` / `HANDOFF-<主题>.md` 这类分册。** 交接内容直接改写 `HANDOFF.md`。已有分册要先把独有信息合并进去、确认无丢失、再删除，并检查有无别处引用它。
- 长期有效的知识**不要**留在 `HANDOFF.md`；`HANDOFF.md` 变长说明有内容放错了位置。
- 更新文档时同步核对里面的数字（测试用例数、完成阶段、关键文件地图）是否还准。

## Git 操作：先获得许可，再执行

**默认不要自己执行 `git commit` / `git push`**，以及 `git reset` / `git rebase` / 强制推送等会改写历史或影响远端的命令。

- 想提交时，先把改动做完、自测通过，然后把「改了什么 + 建议的提交信息」讲给用户，**等用户明确同意后再执行**。
- 用户明确说「提交吧」「commit」= 已授权**本次**提交；下一次仍要重新问。授权不跨任务延续。
- 「你觉得合适就提交」这类不算明确允许——仍然先问。
- `git push` 是对外操作，即使本次提交已获授权，推送也要**单独确认**（当前仓库没有配置远端）。
- 只读命令不受限制，随时可用：`git status` / `git diff` / `git log` / `git show` / `git ls-files` / `git check-ignore`。

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
4. **LLM 永不未经确认改正文**：全文/结构意见必须走「生成 ChangeSet → 差异预览 → 用户确认」。对话历史里回放出来的 assistant 轮次带的旧修改集也一样，只有点「预览修改」并确认才动正文。
5. **API Key 只在服务端环境变量**（`.env.local`，已 git 忽略），绝不进前端 bundle、不进日志、不进 git；用户自带 Key 只存在浏览器 localStorage（见下「安全注意」）。
6. **防注入**：文档内容在 prompt 里被包裹为不可信数据，系统提示规定不执行其中指令；输出仍须过 Zod + 业务校验。

## 关键文件地图

```
src/lib/review-schema.ts        # Zod 协议唯一来源（Document/ReviewItem/ChangeSet/ChatContext/ChatTurn/Conversation）
src/lib/revisions.ts            # 稳定 block ID + revision/checksum
src/lib/anchoring.ts            # 锚点定位（不信坐标，locateInText/locateRange）
src/lib/changeset.ts            # ChangeSet 预处理/重叠剔除/批量应用/撤销快照
src/lib/tiptap-convert.ts       # DocumentState ↔ ProseMirror JSON 互转
src/lib/sample-data.ts          # 内置样例文档 + 10 条假建议（E2E 依赖其措辞）
src/lib/settings.ts             # 用户设置（LLM 命名预设 + 审阅偏好）+ localStorage 持久化 + 旧格式迁移
src/lib/chat-history.ts         # 对话历史纯函数（标题派生、排序、upsert、相对时间），不碰存储与 React
src/lib/storage/db.ts           # Dexie 实例唯一持有者（documents + conversations 两张表）
src/lib/storage/documents.ts    # 草稿文档持久化（含 clearAllDocuments）
src/lib/storage/conversations.ts # 对话历史持久化（列表/保存/删除/清空）
src/lib/llm/thinking.ts         # 思考档位 → 请求参数映射（服务端与前端共用）
src/lib/llm/                    # provider adapter、prompts（审阅+对话）、wire schema、server-helpers
src/components/editor/          # DocumentEditor、BlockIdExtension、ReviewDecorationExtension
src/components/review/          # ReviewSidebar、ReviewCard、ChangeSetPreview、review-meta
src/components/chat/            # ContextChat、ChatHistory（左侧历史栏 + 窄屏抽屉 + 汉堡按钮）
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
7. **遮罩点击关闭** — 模态框/抽屉"点外部收起"的写法要判断 `e.target === e.currentTarget`（面板是遮罩子元素），照 `src/components/SettingsPanel.tsx:134` 抄。只认"点遮罩空白处"，别用 `document` 上的全局点击，那样在面板内拖动松手会误关。
8. **本项目没有动画库**，动效一律手写 CSS keyframes（`globals.css`）。由此有一条固定约束：**退出动画必须延迟卸载**——`{open && ...}` 这类条件渲染会在关闭瞬间卸载节点，淡出/滑出根本没机会播放。做法是加一个「closing」状态在动画期间继续渲染，`onAnimationEnd` 后再真正移除。另外新加的 keyframes 必须同时登记到 `globals.css` 的 `prefers-reduced-motion` 覆盖名单里，漏了的话，明明开了「减少动态效果」的用户反而还会看到动画。

## 左侧对话历史（ChatGPT 式）

对话历史存在 IndexedDB（`conversations` 表），**与草稿文档同一套 Dexie 库不同表**。响应式两种形态：

| 形态 | 触发 | 实现 |
|------|------|------|
| 常驻左栏 | `xl`（1280px）及以上 | `aside[aria-label="历史记录"]`，`sticky top-6` 跟随滚动 |
| 抽屉 | 1280px 以下 | 顶栏汉堡按钮（`ChatHistoryToggle`）拉出 `role="dialog"`，遮罩 + Escape 关闭 |

要点：

- **断点用 `xl` 而不是 `lg`**：主内容区从 `lg` 起就是 `[1fr_360px]` 两栏，再挤进 240px 历史栏，编辑器会窄到不像阅读界面。1280px 是能同时放下三栏的下限（实测 1280 下编辑器仍有 567px）。
- 页面结构是「历史栏 | (编辑器+对话  /  审阅侧栏)」：外层 `flex items-start`，中间那层才是原来的 `lg:grid-cols-[1fr_360px]`；历史栏 `shrink-0`，中间层 `min-w-0 flex-1`。
- **窄屏抽屉的面板必须显式给 `w-60`**：它是 flex 列容器且内容都可收缩，不给宽度就按内容收缩成约 200px，标题被截得比宽屏左栏还窄。配 `max-w-[85vw]` 兜住小屏。
- 历史条目按钮带 `data-conversation-id`（同 `data-review-card` 的约定）。**写测试时别按标题模糊匹配**：删除按钮的 `aria-label` 是「删除对话：<标题>」，也含标题，会同时命中两个。
- 发送消息才创建历史条目（发第一条消息时才分配 id），列表里不会堆空对话。「新对话」只是清空界面，**已保存的那条留在列表里**，随时能点回来——不要改回「清空对话」（那会丢记录）。
- 发给模型的历史只有**当前这条对话**的最近 8 轮，不含其他对话、也不含正文全文（正文按上下文只带相关段落，见 `packBlocks`）。

## 浮动按钮与页面底部布局

页面左下角常驻两个 fixed 浮动按钮，都带 `fixed left-4 z-50`：

| 按钮 | 位置 | 文件 |
|------|------|------|
| 设置齿轮 | `bottom-16`（40×40） | `src/app/page.tsx` |
| 主题切换 | `bottom-4`（40×40） | `src/components/ThemeToggle.tsx` |

它们占视口左下角 x=16..56 这条竖带，而页脚是文档最后的内容、滚到底时正落在这一带，因此**页脚用 `pl-12` 常驻让位**。要点：

- 不要把 `pl-12` 改成只在某个断点生效。中宽视口（768–1360px）内容区贴左，恰恰最容易撞；视口 >1360px 时 `main` 因 `mx-auto max-w-7xl` 居中，反而天然有富余。
- 调整这两个按钮的位置或尺寸时，要同步检查页脚那条 `pl-12` 是否还够——按钮上移或变大会重新压到页脚文字。
- 左下角已是「按钮区」，不要再往这个角放东西（原本 Next 的开发指示器就在这里，已关闭，原因见「已知陷阱」第 11 条）。

**左侧对话历史栏也受这条竖带影响**，它定死了两个数值，改按钮尺寸/位置时要一起重测（`src/components/chat/ChatHistory.tsx`）：

| 元素 | 数值 | 作用 |
|------|------|------|
| 常驻左栏 | `max-h-[calc(100vh-8rem)]` | 减去顶栏（实测 82px）后列表底边不越出视口；用 3rem 会让最后一条被截掉 |
| 常驻左栏 | `pb-28`（112px） | 列表内容止步于按钮上方 |
| 窄屏抽屉 | `pb-28`（112px） | 同上，抽屉里最后一条与「关闭」按钮不被压住 |

实测结果（1920/1440/1366/1280 宽 × 静止/页面滚动/到底，共 15 组）：条目与按钮**零重叠**，最后一条距设置按钮上沿稳定留 63–121px。改动后应重跑这类实测，别只看一个视口。

## 已知陷阱（已经踩过，不要再踩）

1. **`Select` 的浮层是 portal 到 `body` 的。** 设置面板正文是 `overflow-y-auto`，绝对定位的下拉会被裁掉（实测 1280×720 下 170px 的面板只露出 38px）。所以改成了 portal + `fixed` + 下方空间不足自动上翻 + 滚动/缩放跟随。写测试或用 Playwright 找下拉时：`getByRole("listbox")` / `getByRole("option")` 必须从**根**找，**不要 scope 到 `getByRole("dialog")`**（那样 count 是 0）；触发器 `button[aria-label="..."]` 仍在原位，可以正常 scope。
2. **`<main>` 的 `w-full` 不能删**（`src/app/page.tsx`）。`body` 是 `flex flex-col`，而 `<main>` 带 `mx-auto max-w-7xl`：flex 子项在**交叉轴**上一旦有 `auto` 外边距，就不再被 `align-items: stretch` 撑开，而是按 fit-content 定宽——整页宽度于是由内容决定，正文短或刚清空时整页缩窄（1440 视口下 `main` 只有 1029px），正文长时才撑满 1280px。表现是「同一窗口宽度下输入框宽度却在变」，**与滚动条无关**。
3. **`deepseek-flash` 是推理模型，reasoning 会吃 token。** `max_tokens` 必须给足（`/api/review` 当前 16000），否则返回的 `content` 为空、`finish=length`。
4. **新克隆 / 解压源码后先跑一次 `npm run build` 或 `npm run dev`。** Next 在构建时生成 `next-env.d.ts` 与 `.next/types/`，它们被 git 忽略、不在源码包里；缺了它们 `npm run typecheck` 会报 `Cannot find name 'LayoutProps'`——那是缺生成物，不是代码有问题。
5. **E2E 用系统安装的 Google Chrome**（`channel: "chrome"`），不是 Playwright 下载的 chromium——本机缺少后者所需的系统依赖。换环境可 `npx playwright install --with-deps chromium` 后改回默认浏览器。
6. **E2E 强依赖内置样例文本片段**：mock 从请求体按文本反查 `blockId`。改动 `src/lib/sample-data.ts` 的措辞时，必须同步更新 `tests/e2e/helpers.ts`。
7. **React 19 的 lint 规则 `react-hooks/set-state-in-effect` 会报「effect 内同步 setState」。** 用渲染期 derived-state 模式，或用 `useSyncExternalStore` 订阅外部状态（主题切换就是这么做的，同时避免 hydration 不匹配）。
8. **页脚左侧文字曾被浮动按钮盖住**（原来的 `revision N · M 段` 首字符没了，看起来像「evision」）。原因是左下角常驻两个 fixed 浮动按钮，页脚滚到底时正落在它们的竖带里。现已在页脚加 `pl-12` 让位，细节与注意事项见「浮动按钮与页面底部布局」一节。排查这类遮挡要**按文字行**测（`Range.getClientRects()`），测容器框会漏判；且要覆盖多个视口宽度，别只看一个。
9. **版本号只在 `package.json` 里写一次。** `next.config.ts` 构建时读它并内联为 `NEXT_PUBLIC_APP_VERSION`（形如 `v0.1.0`），页脚经 `src/lib/version.ts` 读取；`tests/version.test.ts` 守着这个唯一来源。发版时只改 `package.json` 的 `version`，不要在前端硬编码。注意：Next 的 DefinePlugin 只替换**字面量** `process.env.NEXT_PUBLIC_APP_VERSION`，解构或 `process.env[变量]` 不会被内联（会得到 `undefined`）。页脚**不要再放 `doc.revision`**——它是"改了第几次"的计数器（每敲一个字符就 +1），很容易被误读成第二个版本号，且目前不驱动任何界面行为（见第 12 条）。
10. **隐私/数据发送相关的文案有两处，改一处要同步另一处**：页脚（`src/app/page.tsx`）与 [README.md](./README.md) 的「隐私与数据发送」。它们描述的是同一件事（内容发给谁、密钥存哪），容易过期——供应商从「固定 DeepSeek」改成「用户在设置面板自选」时就漏过。
11. **Next 开发指示器已关闭（`devIndicators: false`）——它是什么、为什么关、怎么恢复。** 这个默认在左下角的黑色小圆标是 Next 的 DevTools 入口，**只在开发模式出现**（`next build` 的生产产物里本来就没有），点开是个小面板：
    - `Route`：当前路由是静态还是动态（如 `Static`）——这是它最有用的信息，用来排查「某个路由为什么没被静态化」；
    - `Bundler`：打包器（`Turbopack`）；
    - `Route Info`：路由段与文件的映射树，附 `Clear Segment Overrides`；
    - `Preferences`：指示器自身的偏好设置。
    关闭理由：本应用布局四角都有内容，实测指示器放哪个角都会遮挡——左下撞页脚文字与自绘浮动按钮、左上撞文档标题（≤1316px 视口）、右上撞「N 条待处理」徽标（900–1316px 视口）、右下撞版本号/段数行。而它主要服务于路由静态化排查，本项目只有 `/` 一个静态页、其余都是 API 路由，用不上；留着反而让人误以为界面有布局 bug。
    需要恢复时（例如以后加了动态路由段要排查渲染行为）：把 `next.config.ts` 里那行改成 `devIndicators: { position: "top-right" }`，或删掉该行使用默认的左下角；开发时也可以点开指示器选「Hide Dev Tools for this session」临时隐藏，不必改配置。编译与运行错误不受此开关影响，仍会照常弹出覆盖层。
12. **`revision` 只是计数器，PLAN 10.5 设计的「响应回来时比对 revision/checksum」尚未接到产品代码里——不要以为它在生效。** 事实核查结果：
    - `revision` 每改一次正文就 +1，**每敲一个字符算一次**（实测：清空后 1，输入 5 个字母后 6）。所以它的数值很大且没有"版本"含义，已从页脚移除。
    - 客户端把 `revision`/`checksum` 发出去、服务端也把 `documentRevision` 原样带回，但**没有任何地方读取返回值做比对**；`isRevisionCompatible()` 目前只被 `tests/revisions.test.ts` 调用。
    - 真正在防"建议过期"的是锚点定位：每次改动后 `handleDocChange` 用 `canLocateScope()` 重新按 `blockId + 原文 + 前后缀` 校验，定位失败即标 `stale`。机制有效，但不等价于设计意图。
    - 若要补齐 PLAN 10.5，需要客户端在响应返回时比对 `documentRevision`/`checksum` 与当前文档，不一致则把该批建议标为可能过期。这是独立的一轮改动，不要顺手改掉 `revision` 字段本身（服务端协议与测试都用它）。
13. **Dexie 的 `version().stores()` 是「合并」语义，不是「每级都要列全」——但删表要显式写 `null`。** 加 `conversations` 表时我一度按「漏写会让旧表消失」去写注释，实测（Dexie 4，`tests/conversations.test.ts` 里留了守护用例）证明是错的：`version(2).stores({ conversations: "id" })` 之后 `documents` 依然在，`db.tables` 是 `["conversations","documents"]`。所以**新增表时多写一行旧表是"为了可读"而不是"为了不丢表"**；真要删表，必须写 `documents: null`。别把这条理解反了去"修" `src/lib/storage/db.ts`。
14. **新增/改动 IndexedDB 表结构时，同时看一眼「清空数据」是否覆盖到它。** 设置面板的「清空数据」调的是 `clearAll`，它会同时清 `documents` 与 `conversations`；以后再加表，忘了加进去就会出现「清空后刷新又冒出来」的怪象。
15. **退出动画必须带 `animation-fill-mode: forwards`，且不要和「延迟卸载」分开记。** 约定 8 的「closing 状态 + `onAnimationEnd` 后卸载」只解决了一半：动画播完到 React 响应事件、提交卸载之间至少还有一帧，没有 fill 的话元素样式会回落到自然位置（抽屉就是 `translateX(0)` 完全可见），表现是「收进去之后闪一下才消失」。进入动画同理用 `both` 防首帧闪烁。排查这类闪烁别靠肉眼，用 `requestAnimationFrame` 逐帧采样 `getBoundingClientRect()`，一帧的跳变立刻现形（实测修复前采样到 x 从 -225 跳回 0）。

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

每完成一项改动，跑 `typecheck` / `lint` / `test`，必要时加 `test:e2e`；提交前先征得用户同意（见上「Git 操作」）。
