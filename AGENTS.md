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
src/lib/review-schema.ts        # Zod 协议唯一来源（Document/ReviewItem/ChangeSet/ChatContext/ChatTurn/ChatNode/Project）
src/lib/revisions.ts            # 稳定 block ID + revision/checksum
src/lib/anchoring.ts            # 锚点定位（不信坐标，locateInText/locateRange）
src/lib/changeset.ts            # ChangeSet 预处理/重叠剔除/批量应用/撤销快照
src/lib/tiptap-convert.ts       # DocumentState ↔ ProseMirror JSON 互转
src/lib/sample-data.ts          # 内置样例文档 + 10 条假建议（E2E 依赖其措辞）
src/lib/settings.ts             # 用户设置（LLM 命名预设 + 审阅偏好）+ localStorage 持久化 + 旧格式迁移
src/lib/chat-history.ts         # 项目纯函数（newProjectId/deriveProjectTitle/sortProjects/upsertProject + 相对时间），不碰存储与 React
src/lib/chat-nodes.ts           # 聊天节点纯函数（findNodeByAnchor 节点身份判定 + deriveNodeTitle），不碰存储与 React
src/lib/migrations.ts           # 旧 documents+conversations → 初始 Project 的迁移（纯函数）
src/lib/mini-markdown.tsx       # 受限 markdown 渲染器（标题/列表/加粗/斜体/行内代码），不引第三方库
src/lib/storage/db.ts           # Dexie 实例唯一持有者（v3 起仅 projects 表；v1/v2 留给迁移期读取）
src/lib/storage/projects.ts     # 项目持久化（saveProject/listProjects/loadLatestProject/loadProject/deleteProject/clearAllProjects）
src/lib/llm/thinking.ts         # 思考档位 → 请求参数映射（服务端与前端共用）
src/lib/llm/                    # provider adapter、prompts（审阅+对话）、wire schema、server-helpers
src/components/editor/          # DocumentEditor、BlockIdExtension、ReviewDecorationExtension、ChatAnchorDecorationExtension
src/components/review/          # ReviewSidebar、ReviewCard、ChangeSetPreview、review-meta
src/components/chat/            # ContextChat、ChatHistory（左栏项目列表 + 窄屏抽屉）、NodeTimeline（节点时间线抽屉）
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
9. **滚动条全局自定义过**（`globals.css`）：细窄（8px）半透明滑块，悬停加深；滑块色用 `color-mix(in srgb, var(--text-faint) 45%, transparent)`、悬停用 `--text-muted`，深浅色自适应。Chrome/Edge/Safari 走 `::-webkit-scrollbar`，Firefox 走 `scrollbar-width: thin` + `scrollbar-color`。新增可滚区域不用单独配，全局生效。**注意**：半透明滑块会叠在内容上，长文滚动有轻微透色，是有意的取舍；别改回不透明的粗条。

## 左侧历史（项目制，一篇文章 = 一个项目）

左侧历史列表的单位是**项目（Project）**：一篇文章的完整工作现场 = 正文 `doc` + 建议 `reviews` + 聊天节点 `nodes`。存在 IndexedDB 的 `projects` 表（`id` 主键 + `doc.updatedAt` 索引），由 `src/lib/storage/projects.ts` 读写。响应式两种形态：

| 形态 | 触发 | 实现 |
|------|------|------|
| 常驻左栏 | `xl`（1280px）及以上 | `aside[aria-label="历史记录"]`，`sticky top-6` 跟随滚动 |
| 抽屉 | 1280px 以下 | 顶栏汉堡按钮（`ChatHistoryToggle`）拉出 `role="dialog"`，遮罩 + Escape 关闭 |

要点：

- **断点用 `xl` 而不是 `lg`**：主内容区从 `lg` 起就是 `[1fr_360px]` 两栏，再挤进 240px 历史栏，编辑器会窄到不像阅读界面。1280px 是能同时放下三栏的下限（实测 1280 下编辑器仍有 567px）。
- 页面结构是「历史栏 | (编辑器+对话  /  审阅侧栏)」：外层 `flex items-start`，中间那层才是原来的 `lg:grid-cols-[1fr_360px]`；历史栏 `shrink-0`，中间层 `min-w-0 flex-1`。
- **窄屏抽屉的面板必须显式给 `w-60`**：它是 flex 列容器且内容都可收缩，不给宽度就按内容收缩成约 200px，标题被截得比宽屏左栏还窄。配 `max-w-[85vw]` 兜住小屏。
- 历史条目按钮带 `data-project-id`（同 `data-review-card` 的约定）。**写测试时别按标题模糊匹配**：删除按钮的 `aria-label` 是「删除文章：<标题>」，也含标题，会同时命中两个。
- **建档时机 = 首次审阅或发聊天**（规则 1）：那之前 `activeProjId` 为 null，防抖保存时才 `newProjectId()` 分配 id。切换/新建文章前会先把当前项目**立即落库**，避免防抖未跑导致旧文章丢失——落库用的是 `latestRef`（最新现场，含防抖窗口内刚敲的字），**不是** `activeProjRef`（它是「上次保存的快照」，用它会把不到 500ms 的编辑丢掉）。「新文章」清空现场但**已保存的项目留在列表里**，随时点回——不要改回「清空对话」。
- **点「新文章」时同步建档（分配 id + 插入列表），不能挂在防抖落库路径上。** 分配 id 只是个 `crypto.randomUUID()`、不需要任何 I/O，早先却要等 500ms 防抖保存跑到 `persistProjectNow` 才发生，于是「点」与「新行蹦出来」之间空出约一秒（用户反馈「先看到旧项目刷新，约 1s 后新项目才蹦出来」）。现在 `handleNewProject` 在点击那一帧就 `newProjectId()` + `upsertProject` + `setJustCreatedId(id)`，出现动画因此与点击因果相连；`latestRef` 也同步推进到新项目（否则随后的防抖保存/聊天回复落库会把旧文章内容写进新 id）。
- **「离开」一篇不算它的活动：切换/新建时落库旧项目不要刷新 `lastActivityAt`。** 只有真正的编辑/回复（走 `persistProjectNow`）才更新它。
- **列表顺序是显式的 `order`（升序），不是按时间派生**（2026-09-16 起支持手动拖动排序）。规则：**一次「活动」把该项目移到最前**，**单纯点开查看不算活动、不改变位置**；手动拖动/键盘移动则直接改写顺序。要点：
  - 「活动」= 编辑正文 / 改标题 / 审阅出结果 / 聊天回复——它们的共同出口是 `persistProjectNow`，置顶就接在这里（`moveProjectToTop`）。点开与「新文章」的旧项目落库走的是 `upsertProject`（**原地替换、不动 order**），别改成置顶。
  - **`upsertProject` 不再是「重排」**：已有 id 只覆盖内容并保留原 order，新 id 才插到最前。历史测试里那套「按 lastActivityAt 重排」的断言已作废（见 `tests/chat-history.test.ts` 的注释与新用例）。
  - 置顶**只改被移动项一行**（order = 当前最小值 − 1），不重编号其余项目——否则每次编辑都要写回全表。因此 order **不保证连续**，只在显式拖动排序（`reorderProjects`）和删除后压回 `0..n-1`。排序时同值由 `lastActivityAt` 兜底，结果稳定。
  - 手动排好的顺序会被后续编辑逐步冲掉（编辑过的都会往顶上跑），这是「活动置顶优先」的既定语义、不是 bug。
  - `order` 在 Zod 里是 **`.optional()`**：`listProjects` 用 `safeParse` 读旧数据，必填会让缺字段的既有项目校验失败、被整条丢弃（看起来像历史全没了）。旧数据由 Dexie **v4** 的 upgrade 按当时的显示顺序回填；`listProjects` 用 `toArray()` 而非 `orderBy("order")` 也是同理——索引会**跳过**缺该字段的行。
- **拖动排序的视觉是「浮起跟手 + 其余项滑开」，两条容易踩的线**：
  - **被拖条目的跟手位移写在 `transform: translateY()` 内联样式里，浮起的放大必须用独立的 `scale` 属性**——如果把 `scale()` 也写进 transform，JS 每帧重写 transform 时会把缩放覆盖掉。
  - 拖动期间**只改 transform、不改 DOM 顺序**：边拖边重排会让行在指针下跳位，也会每帧触发 React 重渲染。其余条目让位一行高，靠 `.t-drag-shift` 的 transition 平滑滑开；松手先播回落再提交顺序（视觉与数据不错位）。让位几何是纯函数 `dragShifts`（`chat-history.ts`），有单测与一致性检查守着。
  - 拖动把手是**独立的小把手**（不是整行）：整行是「点开文章」按钮、内嵌删除按钮，拖动挂整行会和点击语义打架；把手带 `touch-action:none`，列表其余位置因此仍能正常滚动。
- **`listProjects` 的排序依据是 `order`，`loadLatestProject` = 列表第一条**（不再是「最近活动时间最新」的那条）。改动排序语义时这两个函数要一起看。
- **项目落库是防抖的**（编辑触发 500ms），但**聊天回复到达会立即落库**（`persistProjectNow(repliedNodes)`），免得用户在防抖窗口内刷新丢消息。
- **改标题也必须 `setSaveState("saving")`**：它是一次内容编辑，不置 saving 就不触发防抖保存——标题既不落库（改完刷新就丢）、也不算活动（不置顶）。它不走 `handleDocChange` 是为了跳过锚点校验（标题不参与 block 定位）。
- **项目标题派生**：`deriveProjectTitle` 优先取文档手动标题，否则首段截断（24 字符），兜底「未命名文章」。

### 聊天节点（ChatNode）与锚点

聊天按**锚点节点**组织（规则 7/8/10/11/24），一个节点 = 一处锚点 + 一串对话轮次：

- **节点身份（规则 8）**：review 锚按 `reviewId` 认；range 锚**只按选区原文逐字相同**认（blockId/位置/前后缀不参与——选区大小略有出入算同一节点，选中另一段文字就开新行）；block 锚按 `blockId` 认；document 锚整篇共用一个固定节点。
- **发送归属（规则 10）**：有新选区跟新选区，没选区跟正在查看的节点；**只在发送那一刻**找/建节点（规则 7，没有「新建节点」按钮）。「正在查看的节点」同时是上下文的兜底：头部「当前上下文」标签的回退链是 选区 > 选中建议 > **activeNode 的锚点** > 全文（`page.tsx` 的 `chatContext` memo）——选区收起时不该掉回「全文」，这是个修过的 bug，别去掉 activeNode 这一级。
- **规则 11（无选区禁止提问）**：无选区且无选中建议时发送被禁用。E2E 里必须先 `selectTextInEditor` 再发送。
- **规则 12（stale 锚）**：锚点定位失败时节点仍可读，聊天区显示「原文已变更，以下为存档讨论」，正文里的锚点标记消失。
- **规则 24（上下文边界 = 节点边界）**：发给模型的 history 只有本节点轮次；openReviews 只带锚点所在段落的 open 建议。
- 节点时间线（`NodeTimeline`）：聊天区头部「聊天节点历史」按钮**从聊天区顶部向上滑出的抽屉**（第二层抽拉，不是居中弹窗；标题行 `sticky top-0`），按钮是 **toggle**（再按一次收起，带 `aria-expanded`，开态琥珀底高亮）。每行一个节点，行内删除直接删（规则 13，无确认）。**轨道上的端点 = 用户提问，数量恒等于提问次数**（1 次提问 = 1 个端点，单端点居中 left:50%）；行首是**节点身份竖条**（`h-4 w-[3px]`，琥珀）——**不是圆点、不是端点**，2026-09-16 改竖条就是因为圆点会被误认成「多一次提问」。hover 端点浮出自定义摘要 tooltip（锚点摘要 + 该次提问截断 48 字），**钉在抽屉顶部**（标题栏下）而非底部（底部会盖住节点行）；它是**绝对定位悬浮层**（脱离文档流 + `pointer-events-none`）——放进流内会把行撑开、端点位移、hover 循环闪烁（踩过的坑）。抽屉展开时与聊天区连成一体：聊天区顶部圆角让位（`rounded-b-2xl`）、共享边框无线、抽屉 `max-h-[42vh]` 内部滚动。
- 聊天区**浮动**（规则 21 sticky-dock）：`sticky bottom-4`，可最小化成窄条（规则 22）。**高度可拖拽**：头部与消息区之间的把手（`aria-label="调整聊天区高度"`）按住上拉/下拖，范围 180–720px，实时持久化到 localStorage `supergrammarly-chat-height`。新建文章**只在左侧历史栏**，聊天区头部不放「新文章」按钮（曾加过又删掉，与左侧入口重复）。
- 正文锚点标记（`ChatAnchorDecorationExtension`）：range 锚画虚线下划线、block 锚画左侧竖条，点击标记切到对应节点对话。Decoration 是视图层，不序列化进正文。
- **聊天节点专用琥珀色（`--node-*` 令牌，深浅双套）**：节点系统（时间线竖条/端点、正文锚点标记、聊天区头部指示点、历史按钮开态）统一用琥珀色——与审阅红（待处理）/绿（已接受）、品牌绿（主操作）三层语义错开，比绿色更有层次（2026-09-16 用户拍板换琥珀）。令牌：`--node`（主色 `#b45309` / 深 `#d97706`）、`--node-hover`、`--node-soft`（浅底）、`--node-ring`（光晕），已入 `@theme inline` 映射出 `bg-node` / `bg-node-soft` / `text-node` 等类。**新增节点相关样式一律用 `*-node-*`，别再退回 `bg-brand` 或灰绿。** hover 端点的「专注」效果 = 放大 1.5 倍 + 琥珀光晕（`box-shadow` 双层：`--node-soft` 环 + `--node-ring` 泛光）。
- **上下文联动（2026-09-16 反馈修订）**：`page.tsx` 有一个 effect——点击侧栏/正文的另一条建议、或正文里划出新选区时，**聊天视图同步切到该上下文对应的节点**（有节点翻过去、没有则清空显示空态待发）。头部「当前上下文」标签与消息列表因此永远一致（看什么就聊什么）。effect 只依赖 `selection`/`selectedId`（**不能依赖 `nodes`**，否则回复到达等节点更新会误触切换）；选区与建议皆空时不动（chatContext 回退链的 activeNode 一级仍在，焦点不丢）。

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
16. **「自定义指令」等支持 markdown 的输入框要做成「双层」：聚焦显示源文本，失焦渲染成富文本，底层存储与发送的始终是源文本。** 实现方式（`SettingsPanel.tsx`）：textarea 和覆盖在其上的 `<div role="presentation">` 渲染层互斥显示——聚焦时 textarea 可见（`font-mono` 等宽），失焦时渲染层可见、textarea `invisible`（不能 `hidden`/`display:none`，否则占位消失布局跳动）。渲染层用 `onMouseDown e.preventDefault()` + 手动 `focus()` 切回编辑态。渲染器用 `src/lib/mini-markdown.tsx`（受限 markdown：标题/列表/加粗/斜体/行内代码，不引第三方库）。
17. **提示词系统的中英语言是分离的：解释永远中文，replacement 跟文档语言。** 用户场景只有两种（中文文档 / 英文文档），解释都读中文。`buildSystemPrompt` / `buildChatMessages` / `buildChangeSetMessages` 里 `explanationLanguage` 固定中文，`language` 字段只决定 replacement 写成中文还是英文。page.tsx 里 `language: "en"` 是三处写死的，不要把它当 bug 改掉。
18. **浏览器代理插件（Zero Omega / SwitchyOmega）对 LLM 请求无效**——LLM 请求是服务端 `fetch`，不经过浏览器。服务端代理有两条路：(1) 用户在设置面板按预设配（`LLMPreset.proxy`，HTTP/SOCKS5 均可），经 `settingsToRequestBody` → `llmConfig.proxy` → `OpenAIProvider` 的 `undici.ProxyAgent`；(2) 服务端环境变量 `SOCKS5_PROXY` / `HTTPS_PROXY` / `HTTP_PROXY`（`getProviderFromEnv` 自动读）。两条路互斥，用户配置优先。
19. **`scrollIntoView` 的 options 里没有 `top` 字段**——`ScrollIntoViewOptions` 只有 `behavior`/`block`/`inline`，写 `top` 会被浏览器**静默忽略**（不报错）。要把元素对齐到容器内某个精确位置，直接设滚动容器的 `scrollTop`（如 `scroller.scrollTop += delta`），不要往 `scrollIntoView` 里塞自定义坐标。
20. **sticky 元素要「钉住 + 内部滚动」必须用 `h-` 定高，不能用 `max-h-`**——grid/flex 子项默认 `align-items: stretch`，`max-h` 只约束元素自身、约束不了子元素被内容撑高。`max-h-[calc(100vh-3rem)]` 配 `h-full` 的 aside 会被 2900px 的建议列表撑满，内部 `overflow-y-auto` 根本不滚动，表现是「视口下方的卡片永远点不到」（E2E 报 `element is outside of the viewport`，因为 Playwright 滚 window 时 sticky 卡片不动）。改成 `h-[calc(100vh-3rem)]` 后 aside 被限高、内部容器才真正滚动。**但侧栏静止时顶部还有顶栏（实测 82px），`top-6` + `h-[calc(100vh-3rem)]` 会让底边越出视口约 34px（中宽视口 1280 实测）——现已收紧为 `h-[calc(100vh-6.5rem)]`，底边收进视口。** 排查这类「元素可见但点不到/越界」先量 `getBoundingClientRect()` 对比容器高度，别先怀疑测试框架。
21. **React 批处理下，`setState(updater)` 的 updater 副作用不可靠**——在 updater 里写 `ref.current = ...` 或依赖 updater 的返回值，时机由 React 决定（可能延后到本次事件处理完）。聊天节点更新踩过：回复到达时 `setNodes(prev => { ref = compute(prev); return ... })` 后立刻读那个 ref 去落库，读到的还是旧值（updater 没跑），结果存了空节点。正确做法：**先基于 `latestRef.current`（或闭包）算好确定的数组，再 `setNodes(算好的)`**，副作用同步生效、落库也用这个数组。同理闭包里的 `nodes` 是发起请求那一刻的快照，跨 await 后要用 `latestRef` 取最新。
22. **E2E 选词要先处理浮动聊天区遮挡 + Decoration 拆词**——聊天区 `sticky bottom` 会遮住编辑器下方的词（点击落在面板上选不中），且 chat-anchor Decoration 会把词拆成多个文本节点（`getByText(子串)` 命中整段）。`selectTextInEditor` 的做法：用 `document.createRange` + `TreeWalker` 找到 needle 的精确文本节点坐标，先滚到聊天区（`[aria-label="上下文对话"]`）上方，单词直接 `dblclick`，**多词短语先双击词尾再 Shift+点词首**（方向反了会缩回只选第一个词）。断言用上下文标签里「选区「…」」的原文前缀（标签截断到 12 字符），别全等。
23. **`letter-spacing` 会在最后一个字后面也追加字距，且布局把它算进宽度——文字因此不居中，而且用 `Range.getBoundingClientRect()` 自测发现不了。** 「新文章」按钮用 `tracking-[0.3em]`（18px → 5.4px）凑宽度时，`justify-center` 居中的是「三字 + 末尾 5.4px 空白」，墨迹左偏半个字距（实测墨迹中心比按钮中心左 2.708px，右空隙比左大整整一个字距 5.4px）。**我反复"验证通过"是量错了对象**：`Range` 返回的是 advance 宽度（含末尾留白），它的中心当然与容器中心重合，所以每次都报"差 0.008px，已居中"；肉眼看的墨迹中心才是真的。修法是包一层 `-mr-[0.3em]` 用负边距抵消尾随留白（通用手法）。教训有两层：(1) **不要拿 `letter-spacing` 当宽度调节器**，它必然带上末尾留白；(2) 量"文字居中"要量**逐字符 Range 的并集去掉末字字距**，或直接 `getClientRects()` 逐字看墨迹，别量整段 advance 盒再说"居中了"。
24. **「出现动画」的起始态不能写进常驻 class，否则所有没在动的元素都会被它压成 0——曾把整个历史项目列表变成一片空白。** 给新建项目做「占位生长」时，把 `display:grid; grid-template-rows:0fr` 写在 `.t-toast-rise` 基础规则里、无条件挂到每条 `li` 上，结果**没挂动画态的条目行高全是 0**，用户看到的是「之前的项目都不见了」（数据其实都在，量 `li.getBoundingClientRect().height === 0` 即现形）。两条修正同时做才干净：(1) **起始态只写进 `@keyframes`，基础 class 不写**（`animation: toast-rise-rows ... both`），这样动画被禁用/未挂类时元素都是自然高度；(2) **rising 结构只挂在会动的那一条上**，普通条目走普通 `li`（`{rising ? <div className="t-toast-content">{body}</div> : body}`）。另外动画用 `@keyframes` 而非 `transition`：新挂载元素直接带最终样式不触发 transition（没有起始帧可比），关键帧在挂载时自然播放。**教训：CSS 里「只该临时存在」的起始值，一旦写进常驻规则就会永久生效。**

## 有意为之的取舍（不要当 bug 改掉）

- **`stale` 是可逆的**：`handleDocChange` 每次文档变化对建议做**双向**锚点校验——`open` 定位失败标 `stale`，`stale` 若能重新定位（用户撤销/改回原文）就恢复 `open`。只碰 `open`/`stale` 这一对，用户手动「忽略」的 `rejected` 不参与、不会被误恢复。撤销回原文后建议应回到「待处理」，这是设计行为，不是 bug。
- **审阅模式默认「仅纠错」（`proofread`），不持久化**：`page.tsx` 写死默认值，刷新即回默认。记住用户上次选择是后续可选增强，目前不做。
- **侧栏两段补空**：滚动容器首尾各一个 `h-[80vh] shrink-0` 的 `aria-hidden` spacer，让任意卡片都有足够垂直行程与任意高度的正文标记平齐（尤其靠顶/靠底的标记）。这不是多余空白，是对齐机制的行程储备，不要删。**空态（`filtered.length === 0`）不挂 spacer**，否则空态提示文字会被推到视口外。
- **卡片对齐是「中心对中心」，且有上下界钳制**：正文标记是一条线、卡片是一个块，顶部对齐会让卡片重心偏下。`DocumentEditor` 的 `onSelect` 传标记**垂直中心**（`top + height/2`），`ReviewSidebar` 让卡片中心对齐到它。**但完整可见优先于中心对齐**：卡片顶不能高过侧栏可视区上沿、底不能低过下沿——句子靠顶/靠底时若中心对齐会切头/切尾，就降级为「卡片贴齐可视区边缘」，且上下各留 `ALIGN_EDGE_GAP`（8px）呼吸边距、不贴死边缘。改对齐逻辑时这个「先保证完整可见 + 留边距」的钳制不要去掉。
- **对齐用自写 rAF 平滑滚动，不用原生 smooth**：`scrollIntoView({behavior:"smooth"})` 动画期间持续位移会让 E2E「元素稳定」检查超时（实测 flake）。现在的实现是 `ReviewSidebar` 里 rAF 插值 `scrollTop`（ease-out，短距离快、长距离封顶 750ms），**测试环境（`navigator.webdriver`）与 `prefers-reduced-motion` 下直接瞬时定位**，真人浏览才播动画。动画可被取消（连点不同标记会从当前位置重插值），期间用 `aligningRef` 放开滚动钳制。
- **终态卡（已忽略 `rejected` / 已过期 `stale`）视觉弱化但选中仍明确**：背景用 `bg-surface-muted`（浅灰）+ `opacity-75`，区别于正常卡的白底/选中绿卡。弱化不代表看不清选中——选中终态卡时边框加深（`border-foreground/40` + 一圈 `ring-foreground/20`），避免「到底选没选上」的错觉。内层「原文/改为」框在终态卡上改用 `bg-surface` 避免融进灰底。这是有意的「退到背景但可辨识」设计。
- **首尾补空用户滚不进去（滚动钳制）**：补空是给程序对齐用的行程，用户滚轮陷进整屏空白很难看。`ReviewSidebar` 有个 scroll 监听，把用户滚动钳制在「第一张卡片贴顶 / 最后一张贴底」的边界内（**2026-09-16 起收紧到 0 过渡**——原来留了 20% 口子，用户仍会滚进一截空白看到一大块空白，现已改为补空完全不露出）；程序对齐用 `aligningRef` 标志跳过钳制，否则对齐永远到不了补空区。另有一个初始定位 effect：筛选变化/进页面后把 `scrollTop` 钳到补空高度（第一张贴顶），否则默认 0 会整屏露出顶部补空。改对齐或补空逻辑时别把这几个机制拆散。
- **不做按模型能力的档位 clamp 映射表**：思考档位（`auto`/`off`/`low`/`high`/`max`）里端点不支持的档位就直接让它 400 报错给用户，比静默降级更好。将来真要做映射表再加。
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
