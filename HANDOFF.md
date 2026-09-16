# 交接说明（HANDOFF）

> **这是一个临时文件**，只在需要别的 agent / 开发者接手时存在。交接完成后它的内容可以被覆盖或删掉。
> 长期有效的内容不属于这里，改前请先看下面的分工：
>
> | 想了解 | 看哪 |
> |--------|------|
> | 项目是什么、怎么跑、怎么打包部署、隐私与数据发送 | [README.md](./README.md) |
> | 实现约定、踩过的坑、有意为之的取舍、安全注意 | [AGENTS.md](./AGENTS.md) ← **动代码前必读** |
> | 产品需求与原始实施计划 | [plan/PLAN.md](./plan/PLAN.md) |
> | 逐提交的变更记录 | [plan/CHANGELOG.md](./plan/CHANGELOG.md) |
> | 短期任务清单 | [TODO.md](./TODO.md) |
>
> 下面第一节「项目背景」是给接手人的**入门摘要**，权威描述仍是 README / AGENTS / PLAN；
> 如果这几处对不上，以那三份为准，并顺手把这里改对。

---

## 一、项目背景

### 1.1 一句话

**superGrammarly** 是一个**本地优先、Web 优先的 AI 文档审阅工作台**（中文界面）。
它既不是拼写检查器，也不是"让 LLM 直接重写全文"的聊天框：它把 LLM 的审阅结果
**绑定到原文的具体位置**，让用户逐条查看、追问、预览差异，最后**由用户决定**接受哪些改动。

### 1.2 要解决的问题（PLAN 第 1 节）

把长文本（中/英/学术）丢给普通聊天界面做检查时会有这些问题：

1. 建议和原文缺少可靠的视觉对应，长文里根本找不到说的是哪句；
2. 用户得手动查找替换，费事且容易改错位置；
3. "某个词该怎么改"和"整段/全文的判断"混在一起，没有分层；
4. 不同意某条建议、或想让它更保守/更学术时，没法围绕那条建议继续聊；
5. LLM 给出全文重写时，用户看不出到底改了哪些地方，也无法选择性接受。

参考形态是 Grammarly 那类界面：正文有可定位标记，侧栏列出对应建议，点一下能看原因并替换。
本项目在此之上加了**段落级 / 全文级意见**，以及**围绕文档或某条意见继续对话**的能力。

### 1.3 核心工作方式

```text
输入原文
  -> LLM 产生分层审阅结果（全文 / 段落 / 局部）
  -> 程序把结果绑定到全文、段落或具体文本范围
  -> 用户查看意见、追问，或要求生成修改
  -> 程序预览具体差异（ChangeSet）
  -> 用户逐条接受、忽略，或继续调整
  -> 导出 / 复制最终文本
```

### 1.4 七条核心原则（PLAN 2.1，理解这几条就看懂了整个设计）

- **可定位**：局部建议必须能准确指向原文位置。
- **可解释**：每条建议都说明类型和理由。
- **可控制**：LLM **不得未经确认**直接改正文。
- **分层表达**：全文 / 段落 / 局部建议用不同视觉形式。
- **区分判断与操作**：LLM 的观点（`opinion`）≠ 可执行的文本修改（`edit`）。
- **版本安全**：旧的分析结果不能错误地应用到已经变化的新文本上。
- **内容即数据**：文档里出现的指令性文本只当待审内容，不能覆盖系统规则（防注入）。

### 1.5 关键机制（这几条是理解代码的主线）

| 机制 | 在哪 | 说明 |
|------|------|------|
| 稳定 block ID | `src/lib/revisions.ts` + `BlockIdExtension` | 普通编辑保留 ID；拆分保留前半段、后半段新 ID；合并保留目标段；粘贴全文重发 ID |
| 锚点定位（不信坐标） | `src/lib/anchoring.ts` | 一律 `blockId + 逐字 original + prefix/suffix` 定位；**定位失败标记 `stale`，绝不猜位置强改** |
| opinion / edit 严格区分 | `src/lib/review-schema.ts`（`superRefine`） | `opinion` 不可执行且禁带 `replacement`；`edit` 必有 `replacement`，且 scope 不能是 `document` |
| 修改集预览后才落地 | `src/lib/changeset.ts` + `ChangeSetPreview` | 全文/结构意见 → 生成 ChangeSet → 差异预览 → 用户确认；同段重叠修改会剔除 |
| `revision` / `checksum` | `src/lib/revisions.ts` | ⚠️ `revision` 只是**每敲一个字符 +1 的计数器**；PLAN 10.5 设计的"响应回来比对 revision/checksum"**尚未接线**。真正防过期的是上面那条锚点定位（见 AGENTS.md 陷阱 12） |
| 本地持久化 | `src/lib/storage/` | Dexie(IndexedDB)，库名 `super-grammarly`，两张表 `documents` / `conversations`；读写都过 Zod 校验 |
| 密钥与防注入 | `src/lib/settings.ts`、`src/lib/llm/prompts.ts` | 服务端密钥只在 `.env.local`；用户自带的 Key 存在浏览器 localStorage（明文，见 AGENTS.md 安全注意）；文档内容在 prompt 里按不可信数据包裹 |
| 提示词中英分离 | `src/lib/llm/prompts.ts`、`chat-prompts.ts` | 解释永远中文；replacement 跟文档语言（`page.tsx` 里 `language: "en"` 写死） |
| 代理 | `LLMPreset.proxy` → `settingsToRequestBody` → `llmConfig.proxy` → `undici.ProxyAgent` | HTTP/SOCKS5；也可用服务端环境变量 `SOCKS5_PROXY`/`HTTPS_PROXY`/`HTTP_PROXY` |
| 测试连接 | `POST /api/test-connection` | `maxTokens: 64, reasoningEffort: "off"` 发极小请求，10s 超时 |
| 受限 markdown 渲染 | `src/lib/mini-markdown.tsx` | 不引第三方库；标题/列表/加粗/斜体/行内代码；用于自定义指令框失焦预览 + explanation/对话渲染 |

### 1.6 技术栈与代码地图

- Next.js 16（App Router，Turbopack）+ React 19 + TypeScript 5 + Tailwind 4
- 编辑器 Tiptap 3；建议标记用 Decoration **渲染出来、不序列化进正文**
- 运行时协议唯一来源：Zod schema（`src/lib/review-schema.ts`），前后端共用
- 包管理 npm；`src/` 目录，别名 `@/* → src/*`
- 完整的「关键文件地图」在 [AGENTS.md](./AGENTS.md)，别在这里维护第二份

主界面是单页 `src/app/page.tsx`（几乎所有状态与接线都在这个文件），页面结构：

```text
顶栏（标题 / 审阅模式 / 开始审阅 / 复制全文 / 待处理数 / [窄屏汉堡按钮]）
└─ 三栏行： 历史记录 |（编辑器 + 对话）|  审阅建议侧栏
页脚（版本号 / 段数 / 隐私说明）
左下角常驻两个浮动按钮：设置（bottom-16）、主题切换（bottom-4）
```

服务端四个 API 路由：`/api/review`（整篇审阅）、`/api/chat`（上下文对话）、
`/api/change-set`（把一条意见转成可执行的修改集）、`/api/test-connection`（测试连通性）。

---

## 二、当前状态

**侧栏交互改进 + 四个反馈问题已处理，E2E 23 个全绿，质量门禁全过。改动未提交，在工作区。**

### 2.1 侧栏交互改进（已完成）

1. **0 意见分区隐藏**：无筛选时 0 意见的空分区整区隐藏，被筛选排除的空分区保留作 landmark。
2. **双向定位 + 侧栏卡片对齐正文**：点正文标记 → 卡片滚动对齐到与标记齐平；点侧栏卡片 → 正文滚到对应范围并选中。坐标经 `anchorTop`（正文标记视口 top）传递。
3. **sticky 侧栏**：`sticky top-6 h-[calc(100vh-3rem)]` 钉在视口顶部，内部独立滚动。
4. **全文建议点击滚到总结横幅**。

### 2.2 四个反馈问题（本轮处理）

1. **发消息没留痕 → 实测无 bug**。发送后 IndexedDB 立刻写入、左侧列表立刻出现、回复后更新轮次、刷新后保留。功能正常。若再遇到，需具体操作顺序定位（可能是边界场景）。
2. **改了又撤销仍「已过期」→ 已修**。`handleDocChange` 改双向校验：`stale` 若能重新定位（撤销/改回原文）恢复 `open`。实测改原文→已过期、撤销→恢复待处理。
3. **审阅模式默认 → 改为「仅纠错」**（`page.tsx` `useState<ReviewMode>("proofread")`），不持久化。
4. **滚到顶对不齐 → 已修（两段补空）**。侧栏滚动容器首尾各加 `h-[80vh] shrink-0` spacer，任意卡片都能与任意高度标记平齐。实测靠顶标记 delta 0 完全平齐。

### 2.3 补空引入的回归（本轮修复）

- **空态 spacer 把提示文字推到视口外 → 已修**：spacer 改为仅 `filtered.length > 0` 时渲染，0 建议/筛选为空时不挂，空态文字回到侧栏顶部、无多余滚动条。
- **滚动条丑 → 全局自定义**：细窄（8px）半透明滑块，悬停加深，`color-mix` 配 `text-faint`/`text-muted` 令牌，深浅色自适应（`globals.css`）。

### 2.3 关键改动文件

- `src/app/page.tsx` — sticky `h-[calc(100vh-3rem)]`、stale 双向恢复、mode 默认 `proofread`、`anchorTop` state、`summaryRef`
- `src/components/review/ReviewSidebar.tsx` — 分区隐藏、`anchorTop` prop、对齐 effect（设 `scrollRef.scrollTop`）、首尾 spacer（仅 `filtered.length > 0` 渲染）
- `src/components/editor/DocumentEditor.tsx` — `getItemViewportTop()`、`onSelectReview` 带 `viewportTop`
- `src/app/globals.css` — 全局半透明滚动条（`::-webkit-scrollbar` + `scrollbar-color`，`color-mix` 令牌）
- `tests/e2e/helpers.ts` / `core-flow.spec.ts` — `scrollCardIntoView()`
- `AGENTS.md` — 陷阱 19/20、取舍条目、界面约定第 9 条（滚动条）

### 2.4 质量基线

- `npm run typecheck` ✅ / `npm run lint` ✅ / `npm run test` ✅ 124 个 / `npm run test:e2e` ✅ 23 个
- 浏览器实测：双向定位与对齐（delta 0）、stale 双向恢复、默认仅纠错、历史留痕，全部通过
- 开发服务器在 :3000 运行中（`npm run dev`）

> ⚠️ **工作区有未提交改动**。按 AGENTS.md 的「Git 操作」约定，
> **commit / push 必须先获得用户明确同意**，不要自己提交。

---

## 三、本机环境（交接用）

- `.env.local` 已配好密钥（git 忽略），当前 `LLM_MODEL=deepseek-flash`。
- 开发服务器跑在 http://localhost:3000 （`npm run dev`）。
- 生产服务器可跑在 http://localhost:3001 （`npm run build && npx next start -p 3001`）。
- 真实 DeepSeek 链路已跑通：审阅返回三层建议、侧栏↔正文双向定位、单条接受改正文、
  对话生成修改集并预览接受、测试连接返回 `{"ok":true}`。
- E2E 用**系统安装的 Google Chrome**（`channel: "chrome"`），不是 Playwright 下载的 chromium
  ——本机缺后者所需的系统依赖。E2E 会 mock 掉 LLM，**不消耗 API 额度**。
- **浏览器实测注意**：开发服务器（Turbopack）热更新不稳定，新代码可能不生效。
  用生产构建（`npm run build` → `npx next start -p 3001`）验证最可靠。

---

## 四、下一步

### 4.1 提交

质量门禁已全绿（typecheck / lint / 124 单测 / 23 E2E），浏览器实测双向定位与对齐通过。
按 AGENTS.md 规则向用户讲清改动并等 commit 授权。

## 五、接手建议

1. 先跑一遍基线确认现状：`npm run test`（124 个，应全过）与 `npm run test:e2e`（23 个，应 2 挂）。
2. **动代码前读 [AGENTS.md](./AGENTS.md)**，尤其是「必须遵守的核心约束」「界面开发约定」
   「浮动按钮与页面底部布局」「已知陷阱」——里面记着这个项目已经踩过的 18 个坑，
   其中好几个是"看起来像 bug、其实是有意为之"的取舍。
3. 改完按 AGENTS.md 收尾：跑 `typecheck` / `lint` / `test`，必要时加 `test:e2e`；
   **提交前先征得用户同意**。
