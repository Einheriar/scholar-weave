# 已定方案：项目式历史 + 锚点节点聊天 + 浮动聊天区

> 状态：**已定方案 + 实现规格 + 执行计划**（2026-09-16 与用户逐点确认，含三个执行决策）。
> 本文是供**执行 agent** 直接照着做的完整规格：概念模型、逐条行为规则、美学/状态设定、改动点清单、分阶段规划、验收清单、**执行决策与数据模型细节**。
> 相关：[../AGENTS.md](../AGENTS.md)（「左侧对话历史」「浮动按钮与页面底部布局」「界面开发约定」三节，实现后需回写）、[./PLAN.md](./PLAN.md)

---

## 第一部分：概念模型（一句话版）

工具的主角是**文章**。左栏「历史记录」= 我处理过的**文章列表**（不是聊天记录）；每篇文章是一个**项目**，装着它的正文、审阅建议状态、以及全部聊天；聊天按**锚点节点**（挂在文章某词/段/建议上的讨论）组织，不常驻界面，由一个**节点时间线**弹层做导航；聊天区整体可**浮动**、可**最小化**。

```
左栏历史 = 项目列表（一项 = 一篇文章的完整工作现场）
项目 = 正文 + 审阅建议状态 + 聊天节点列表
聊天节点 = 一次提问锚定的上下文（词 / 段落 / 选区 / 某条建议）+ 该节点下的线性往返对话
```

---

## 第二部分：逐条行为规则（26 条，全部已与用户确认，勿翻案）

### A. 项目（左栏历史）

1. **建档时机**：首次「开始审阅」或首次发送聊天，哪个先发生都算建档（不存在「聊了半天没审阅就丢记录」）。因规则 11，纯空文档无法提问，故实际建档总发生在正文已有内容之后。
2. **排序**：按最近活动排，最新编辑 / 聊天 / 审阅的项目在最上面，无需手动整理。
3. **删除**：左栏条目带删除按钮，删除整篇文章连同其建议与聊天记录。
4. **「新对话」改名换义为「新文章」**：清空正文 + 建议 + 聊天，开一个新项目；旧文章留在左栏。（吸收了原候选方向乙。）
5. **正文被改没**：历史项目对应的正文若被清空 / 整篇替换（锚点全部定位不到），点开时提示「正文已变更」，当时的建议与聊天记录仍可查看。

### B. 聊天节点（文章内部的讨论地图）

6. **节点 = 一次提问所锚定的上下文**。类型复用现有 `ChatContext` 四种：`document / block / range / review`（词、段落、选区、某条建议均可为锚）。
7. **节点诞生规则**：**按下发送的那一瞬间**才创建节点，选中选区本身不创建（用户会随手划选）。无「新建节点」按钮；选区与现有节点身份相同则追加进该节点，否则自动开新节点。
8. **节点身份**（决定「接旧线还是开新线」）：锚定建议 → 按 `reviewId` 认（同一建议的提问永远接同一条线）；锚文字 → 按选区**原文逐字相同**认（`upstanding` 选得大小略有出入也算同一节点；选中另一段文字就开新行）。
9. **节点内部是线性的往返对话，不分叉**；节点之间平铺并列。
10. **节点内发消息的归属**：正在翻看旧节点时发送 → 接在旧节点末尾（无需重新选词）；此时正文里有新选区 → **新选区优先**（接新选区对应节点，已有则追加、没有则新建）。即「当前上下文」取值 = 有新选区跟新选区，没选区跟正在查看的节点。
11. **无选区禁止提问**；想问全文请用户自行全选（直觉操作，不做特殊「全文节点」）。**阶段 3 起严格执行。**
12. **锚点失效**（原文被改 / 删）：节点保留、对话可读、**可继续提问**（用建档时存的原文 + 标注「原文已变更」）；正文内的锚点标记消失。
13. **行内删除**：节点时间线每行最右带删除按钮，删该行全部讨论（防冗杂）。**直接删除，不弹确认**（删的是单节点讨论、非整篇文章）。

### C. 节点时间线（视觉呈现）

14. **入口**：聊天条头部左侧加「历史」按钮（原「当前上下文」标签右移让位），点击弹出抽象时间线面板。
15. **形式**：一条横线 = 一个节点；线上的端点 = 一次提问；多条线并列 = 多个节点。节点对话**不常驻**界面，时间线是「地图 / 目录」。
16. **行内不带摘要文字**；**hover 端点 / 行时悬浮显示锚点摘要**（`title` 或 tooltip）。
17. **排序**：按节点创建时间排。
18. **当前节点指示**：正在聊的节点 / 最新端点有高亮态，明确「下一句提问接在哪条线的尾巴上」。
19. **点端点行为**：聊天区切到该节点的对话视图，并滚动到该端点对应的轮次（就地切换 + 滚动，非跳转新页面）。

### D. 聊天区（浮动 + 经典聊天布局）

20. **布局**：经典聊天软件形态——消息列表在上（限高、内部滚轮滚动看完整历史），输入框钉在最下。
21. **浮动**：页面静止时聊天区在文档流原位；上滑至其即将滚出视口时，**整个聊天区（消息列表 + 输入框）脱离文档流吸附到视口底部**；回滚至原位则归位（sticky-dock + 过渡动画）。
22. **最小化**：聊天区带最小化按钮，可收起为「只有输入框」的窄条（即现在的形态），方便阅读正文时腾空间；再点恢复展开。
23. 动机：选中词 / 段 → 当场提问当场看回复，不滚回底部。

### E. LLM 上下文供给

24. **节点边界即上下文边界**：锚点原文（含已被用户改过的当前版本，两者都给）+ 所在完整段落（复用 `packBlocks` 作语义环境）+ 范围内未处理的审阅建议 + 本节点全部历史轮次（过长时摘要 / 截断）；**跨节点的对话一律不给**（省 token 且防干扰）。**「范围内未处理建议」= 仅锚点所在段落（blockId 相同）的 `open` 建议**（执行决策 3）。
25. 锚点定位复用 `src/lib/anchoring.ts`（blockId + 原文 + 前后缀），不信任坐标的老原则对节点同样成立。
26. **节点内 assistant 回复带修改集时，仍走「预览修改 → 确认」**（AGENTS.md 核心约束 4），节点化不绕过确认。

---

## 第三部分：美学与状态设定（执行 agent 照此实现，勿自行发挥）

> 总原则：严格遵守 AGENTS.md「界面开发约定」10 条——**用语义令牌**（`bg-surface` / `bg-surface-muted` / `bg-brand` / `text-text-muted` / `text-text-faint` / `border-border` 等，`globals.css` `@theme inline` 已映射、自带深浅双套值），**不要手写 neutral/blue 色值**；新样式都要有 `dark:` 变体；动画复用现有 keyframes 并登记进 `prefers-reduced-motion` 名单。

### 3.1 设计令牌速查（`src/app/globals.css`）

| 用途 | 令牌 | 浅色值 | 深色值 |
|------|------|--------|--------|
| 页面底 | `bg-background` | `#f2f5f4` 暖白灰 | `#0e1311` 墨绿黑 |
| 卡片 / 面板 | `bg-surface` | `#ffffff` | `#171d1a` |
| 次级背景 | `bg-surface-muted` | `#f7f9f8` | `#131916` |
| 边框 | `border-border` | `#dfe7e3` | `#2a332f` |
| 强调边框 | `border-border-strong` | `#c9d4cf` | `#3a453f` |
| 次文字 | `text-text-muted` | `#5f6f68` | `#8fa098` |
| 弱文字 | `text-text-faint` | `#93a29b` | `#5f6f68` |
| 主操作绿 | `bg-brand` | `#0da678` | `#2cc493` |
| 主操作绿 hover | `bg-brand-hover` | `#0b9069` | `#3fd6a5` |
| 浅绿底（选中态） | `bg-brand-soft` | `#e3f4ee` | 绿 12% 透明 |
| 聚焦环 | `ring-brand-ring` | `#a8dcc9` | 绿 35% 透明 |

### 3.2 聊天区（`ContextChat` 重构后）

- **外壳**：沿用现有 `rounded-2xl border border-border bg-surface shadow-sm`。浮动时**外壳不变**，仅定位变（见 3.6）。
- **头部**（`border-b border-border px-4 py-2 text-xs`）：从左到右 = 「历史」按钮（图标按钮，见 3.3）→「当前上下文：…」标签（`text-text-muted`，上下文名 `font-medium text-foreground`）→ 右侧「最小化 / 展开」按钮 + 「新文章」按钮（`text-text-faint hover:bg-surface-muted hover:text-foreground`，同现有「新对话」的按钮样式）。
- **消息列表**：`max-h-56 space-y-2.5 overflow-y-auto px-3.5 py-3`（沿用现有）。用户气泡 `ml-10 rounded-2xl rounded-br-sm bg-brand text-white dark:text-neutral-950`；assistant 气泡 `mr-10 rounded-2xl rounded-bl-sm bg-surface-muted text-foreground`；新消息进列表用 `animate-item-in`。「正在思考…」三点动画沿用现有（`bg-text-faint` + `animate-bounce` 错峰）。**显示的是「当前节点」的对话**，不是全文混合流。
- **输入框区**：`border-t border-border p-2.5`，textarea `rounded-xl border border-border bg-transparent focus:border-brand focus:ring-2 focus:ring-brand-ring`；发送按钮 `buttonClass("primary","md")`（绿底）。placeholder 动态带当前上下文名。
- **「原文已变更」标注**：锚点失效节点的对话视图顶部加一条提示条：`bg-surface-muted text-text-muted text-xs rounded-lg px-3 py-2`，文案「原文已变更，以下为存档讨论」。
- **当前节点指示**：头部「当前上下文」标签左侧加一个 6px 实心圆点（`bg-brand`），pulse 微动画（复用 `animate-bounce` 或新 keyframes 需登记 reduced-motion），提示「正在聊这个节点」。

### 3.3 节点时间线弹层

- **入口按钮**：聊天条头部左侧，图标按钮（可用 `≡` / 列表图标 + `aria-label="聊天节点历史"`），`rounded-md p-1 text-text-faint hover:bg-surface-muted hover:text-foreground`。
- **弹层容器**：绝对定位于聊天条上方（`bottom-full mb-2 left-0`），`w-full max-w-md rounded-2xl border border-border bg-surface shadow-lg`，进入动画 `animate-modal-pop`（已含 fade+pop，且已登记 reduced-motion）。遮罩点击关闭照 `SettingsPanel.tsx:134` 的 `e.target === e.currentTarget` 写法（或轻量方案：点击弹层外部关闭，监听 `pointerdown` 在弹层外）。
- **每行（一个节点）**：`flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-muted`。行内三段：
  - 左：6px 节点色圆点（色见 3.4）；
  - 中：横线 SVG / CSS——`h-0.5 bg-border-strong rounded-full` 为轨道，端点是 `h-2 w-2 rounded-full` 实心圆，**颜色同节点色**；端点沿轨道均匀分布；
  - 右：删除按钮（`text-text-faint hover:text-foreground`，`aria-label="删除该节点讨论"`）。**点击直接删除，不弹确认**（执行决策 2）。
- **当前节点行**：`bg-brand-soft`（浅绿底），圆点和端点色加深。
- **hover 端点**：端点放大（`scale-125` 过渡）+ 悬浮摘要 tooltip（`rounded-md border border-border bg-surface px-2 py-1 text-xs shadow-md`，内容为锚点原文截断 12 字）。
- **点端点**：聊天区消息列表 `scrollTo` 到对应轮次气泡（用 `data-turn-index` 定位，平滑滚动，测试环境瞬时——照 `ReviewSidebar` 的「`navigator.webdriver` 下直接瞬时定位」约定）。

### 3.4 节点 / 锚点标记的颜色（关键决策：用品牌绿，不引新色相）

- **原则**：整套 UI 的品牌色就是绿，节点系统不另起新色相，靠**明度 / 饱和度 / 透明度**区分。这样既和审阅标记（红 = 待处理问题、绿 = 已接受）错开语义，又保持整体克制。
- **节点圆点 / 端点**：`bg-brand`（主绿）；当前节点行用 `bg-brand-hover`（深一号绿）+ `bg-brand-soft` 底。
- **正文内被聊过的文字**：底部 **2px 点状下划线**（`text-decoration: underline dotted` 或 `border-bottom: 2px dotted`），颜色 `text-text-faint`（弱灰绿，比审阅的红 / 绿更弱一档，避免与审阅标记争视觉优先级）；hover 时变 `text-text-muted` 加深 + 悬浮「有 N 条讨论」提示；点击跳到聊天区对应节点。
- **绝不使用**：红（= 审阅待处理）、新引入的蓝 / 紫 / 橙等色相（破坏令牌体系）。

### 3.5 左栏项目列表

- 沿用现有 `ChatHistory` 外壳（常驻左栏 `xl` 以上 `aside[aria-label="历史记录"]`、窄屏抽屉 `role="dialog"`）。
- 条目按钮：标题（文章开头截断）+ 副标题「最近活动：x 分钟前」（相对时间，复用 `chat-history.ts` 的相对时间函数）。当前打开的条目 `bg-brand-soft`。
- 删除按钮沿用现有「删除对话：…」模式（`aria-label="删除文章：<标题>"`），文案与 aria 改为「文章」。删除整篇仍弹 `window.confirm`（规则 3 删除的是整个项目）。
- **保留 AGENTS.md 已定**：断点 `xl`、抽屉 `w-60 max-w-[85vw]`、`max-h-[calc(100vh-8rem)]` + `pb-28` 避让左下浮动按钮、条目带 `data-project-id`（原 `data-conversation-id`）等数值，见 AGENTS.md「左侧对话历史」「浮动按钮与页面底部布局」两节，实现时照抄不重测。

### 3.6 聊天区浮动（sticky-dock）

- **实现**：`position: sticky; bottom: 1.5rem`（在文档流中自然吸附，无需滚动监听）或滚动监听 + `fixed bottom-6`（二选一，优先 sticky 方案——纯 CSS、无 JS 抖动）。归位 / 吸附过渡用 `transition` 或一次性 `animate-item-in`，不要 rAF 逐帧（与 `ReviewSidebar` 的对齐动画不同场景）。
- **浮动时**：聊天区 `max-w` 与编辑器同宽，不超出内容列；`z-40`（低于设置模态 `z-50`）。
- **避让**：浮动聊天区在视口底部，**不得遮挡左下角两个 fixed 按钮（设置 `bottom-16` / 主题 `bottom-4`）与页脚 `pl-12` 让位区**——聊天区居中于内容列、左右留白即可天然避开，实现后用 AGENTS.md 第 8 条的「按文字行测 `Range.getClientRects()`」方法多视口验证。
- **reduced-motion**：吸附 / 归位不做位移动画，直接切换。

### 3.7 动画登记表

新增组件只用现有 keyframes：`animate-item-in`（消息进入）、`animate-modal-pop`（弹层）、`animate-modal-fade`（遮罩）。**若新增 keyframes**（如节点圆点 pulse），必须同步登记进 `globals.css` 的 `@media (prefers-reduced-motion: reduce)` 覆盖名单（现有名单已含 `animate-modal-fade, animate-modal-pop, animate-item-in, animate-drawer-in, animate-drawer-out, animate-modal-fade-out`），并遵循 AGENTS.md 第 8、15 条：退出动画 `closing` 状态延迟卸载 + `animation-fill-mode: forwards`。

---

## 第四部分：执行决策（2026-09-16 用户拍板，覆盖实现细节）

1. **数据模型演进 = 迁移后删除旧表**。Dexie 升到 `version(3)` 加 `projects` 表；upgrade 钩子里把旧 `documents` + `conversations` 组装成初始 Project 导入 `projects`，然后 `documents: null, conversations: null` 显式删旧表（AGENTS 第 13 条语义）。`projects` 只索引 `id` + `doc.updatedAt`（顶替原 `documents.updatedAt`，让 `loadLatestProject()` 走索引排序）；`reviews` / `nodes` 不入索引，只在内存过滤（本地单人够用，符合「只索引主键和查询字段」约定）。
2. **节点时间线删除按钮直接删**，不弹 `window.confirm`（删的是单节点讨论、非整篇文章；整篇项目删除仍 confirm）。
3. **「范围内未处理建议」= 仅锚点所在段落（blockId 相同）的 `open` 建议**，注入 LLM 请求；跨段落建议不带。

### 数据模型细节（阶段 1 照此实现）

- **`ChatNodeSchema`**：`{ id: string, anchor: ChatContextSchema, originalText: string（原文快照，锚点失效后仍可展示/继续提问）, createdAt: string, turns: ChatTurnSchema[] }`。
- **`ProjectSchema`**：`{ id: string, title: string, doc: DocumentStateSchema, reviews: ReviewItemSchema[], nodes: ChatNodeSchema[], lastActivityAt: string }`。
- **节点身份判定**（规则 8，仅按选区原文相同）：`review` 锚按 `reviewId` 认；`range` 锚按 `anchor.selectedText` 逐字相同认（位置 / 前后缀不参与）；`block` 锚按 `blockId` 认；`document` 锚整篇共用固定全文档节点。
- `ConversationSchema` / `ChatContextSchema` / `ChatTurnSchema` 保持不变；`Conversation` 仅作迁移期读取旧数据的临时结构，迁完即弃，`src/lib/storage/conversations.ts` 与 `documents.ts` 删除。

---

## 第五部分：改动点清单（对照实现）

| 文件 | 改动 |
|------|------|
| `src/lib/review-schema.ts` | 新增 `ChatNodeSchema`、`ProjectSchema`；`Conversation` 仅留作迁移期读取 |
| `src/lib/storage/db.ts` | Dexie `version(3)` 加 `projects: "id, doc.updatedAt"`；upgrade 迁移旧数据→初始 Project，然后 `documents:null / conversations:null` |
| `src/lib/storage/projects.ts` | 新增：`saveProject / listProjects / loadProject / deleteProject / clearAllProjects`（照 `conversations.ts` 模式，读写过 schema） |
| `src/lib/storage/conversations.ts` / `documents.ts` | 删除（迁完即弃） |
| `src/lib/chat-history.ts` | 派生函数：`deriveProjectTitle(doc)`（正文首段截断）、`upsertProject / sortProjects / newProjectId`、`deriveNodeTitle`（锚点原文截断，供时间线 hover）；`formatRelativeTime` 复用 |
| `src/lib/chat-nodes.ts`（新） | 节点身份判定纯函数 `findOrCreateNodeId(nodes, anchor)` 与「当前上下文取值」逻辑（规则 8/10） |
| `src/components/chat/ChatHistory.tsx` | 改为项目列表（标题 / 最近活动 / 删除 / 恢复快照）；`data-conversation-id` → `data-project-id`；「新对话」→「新文章」；空态文案 |
| `src/components/chat/ContextChat.tsx` | 重构为节点化聊天区：头部（历史按钮 + 上下文标签 + 最小化 + 新文章）+ 当前节点消息列表（`data-turn-index`）+ 输入框；「原文已变更」提示条；节点时间线弹层子组件 |
| `src/components/chat/NodeTimeline.tsx`（新） | 节点时间线弹层（行=节点、端点=提问、删除、当前节点高亮、hover 摘要、点端点滚动） |
| `src/app/page.tsx` | sticky-dock 浮动逻辑；「新对话」→「新文章」；项目切换 / 恢复快照；建档时机（规则 1）；防抖保存把 reviews + nodes 一并写进 project；无选区禁止提问拦截（规则 11）；节点身份判定与建档 |
| `src/lib/llm/chat-llm-schema.ts` | 请求加「锚点段落 open 建议」字段；`history` 语义改为「本节点全部轮次」 |
| `src/lib/llm/chat-prompts.ts` | 按规则 24 组装节点边界上下文（复用 `packBlocks`，注入锚点段落 open 建议，history 取本节点 turns） |
| `src/components/editor/ChatAnchorDecorationExtension.ts`（新） | 正文被聊文字点状下划线标记（照 `ReviewDecorationExtension`，独立 PluginKey + `data-chat-anchor-id` + 只发 `Decoration.inline`，不序列化）；点击跳节点 |
| `src/components/editor/DocumentEditor.tsx` | 加 `chatAnchors / selectedChatNodeId / onSelectChatAnchor` props 与 ref 同步、meta 派发；选区→偏移换算挂 `onSelectionUpdate` |
| `src/app/globals.css` | `.chat-anchor` 点状下划线（`--text-faint` 2px dotted，hover `--text-muted`），避开 `rev-` 前缀，dark 变体 |
| `tests/` + `tests/e2e/` | 随结构演进；`conversations.test.ts`→`projects.test.ts`；E2E `helpers.ts` mock 按新协议更新、`chat-history.spec.ts` 改项目语义、`review-chat.spec.ts` 改选区后发 |

---

## 第六部分：分阶段实现规划

**阶段 1 — 数据层（不动界面）**
`review-schema.ts` 加 `ChatNode` / `Project`；Dexie v3 迁移（旧数据→初始 Project→删旧表）；`projects.ts`；`clearAll` 覆盖新表；`chat-history.ts` / `chat-nodes.ts` 派生纯函数。配纯函数单测（Vitest + fake-indexeddb）+ 迁移用例。验收：旧数据无损迁移进 projects、旧表已删、schema 校验通过、clearAll 覆盖。

**阶段 2 — 左栏项目列表**
`ChatHistory` → 项目列表（标题 / 最近活动 / 删除 / 恢复快照）；「新对话」→「新文章」；防抖保存把 reviews + nodes 写进 project；建档时机。验收：点开历史项目完整恢复正文 + 建议状态 + 聊天；删除清空；刷新后项目仍在。

**阶段 3 — 聊天区节点化（核心）**
`ContextChat` 重构 + `chat-nodes.ts` 节点身份判定 + 上下文组装 + 无选区禁止提问。验收：选词提问建档、同词再提追加、改选区开新节点、翻看旧节点时发送接旧节点、无选区禁止提问（报错 + aria-live 播报）。

**阶段 4 — 节点时间线弹层**
`NodeTimeline.tsx` + 「历史」按钮接线。验收：多节点切换、行内删除（直接删）、当前节点高亮、点端点切对话 + 滚动到对应轮次、美学符合 3.3。

**阶段 5 — 浮动 + 最小化**
sticky-dock + 最小化。验收：多视口（1920/1440/1366/1280）滚动吸附 / 归位无抖动、不遮挡左下按钮与页脚、reduced-motion 下无动画。

**阶段 6 — 正文锚点标记 + 测试收尾**
`ChatAnchorDecorationExtension` + `.chat-anchor` CSS + 点击跳节点；补齐 E2E / 集成测试；回写 AGENTS.md「左侧对话历史」一节与 `plan/CHANGELOG.md`。

**执行方式**：连续执行 6 个阶段，每阶段跑 `typecheck` / `lint` / `test`（阶段 3/6 加 `test:e2e`）自测通过后，报「改了什么 + 建议提交信息」、经用户同意 commit，再进入下一阶段。阶段 3 最重，动手前已单独确认交互规则（本文件第二部分）。

---

## 第七部分：验收总清单（执行 agent 自查）

- [ ] 26 条行为规则逐条可演示
- [ ] 美学符合第三部分（语义令牌、dark 变体、reduced-motion 登记、避让左下按钮）
- [ ] 不破坏 AGENTS.md 核心约束 6 条（锚点定位 / opinion-edit 区分 / LLM 不擅自改正文 / Key 安全 / 防注入）
- [ ] localStorage key、Zod schema 协议、API 路由、aria-label、键盘导航、`aria-live` 不破
- [ ] 「清空数据」覆盖新表；旧数据迁移无损、旧表已删
- [ ] 多视口实测（含左下浮动按钮遮挡按文字行测）
- [ ] `typecheck` / `lint` / `test` / `test:e2e` 全绿

---

## 附：历史分歧与候选方向（存档，已被上文取代）

<details>
<summary>2026-09-16 初稿：概念模型分歧与三个候选方向（甲/乙/丙）</summary>

用户曾反馈「粘贴文字后历史没更新」「新对话没删原文」。排查结论为概念模型分歧：旧实现里「历史记录」只装对话，不装审阅行为与文档版本。当时列了三个候选方向：(甲) 审阅行为进历史；(乙) 一键「全新开始」；(丙) 概念合并成工作区。

经多轮讨论，实际达成的是**比 (丙) 更彻底的项目制**：历史组织单位从「对话」换成「文章」，聊天降级为文章附属并按锚点节点组织；方向 (乙) 被「新文章」语义吸收。
</details>
