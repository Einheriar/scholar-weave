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

服务端三个 API 路由：`/api/review`（整篇审阅）、`/api/chat`（上下文对话）、
`/api/change-set`（把一条意见转成可执行的修改集）。

---

## 二、当前状态

**阶段 0–10 全部完成，无阻塞。** 已实现的功能没有已知缺陷或坏掉的地方；第四节的两条
抽屉待办（遮罩点击关闭、开合动画）已完成并实测通过。PLAN 定义的阶段 0–6 均已落地；
阶段 7–9 （界面优化、界面美化、思考档位四档化 + 模型配置预设）以及阶段 10「左侧对话历史」
是在 PLAN 之外追加的迭代。

| 阶段 | 状态 | 说明 |
|------|------|------|
| 0 项目初始化 | ✅ | Next 16 脚手架、依赖、Vitest、typecheck/test/lint 脚本 |
| 1 编辑器与稳定段落 | ✅ | 文档模型、revision/checksum、BlockIdExtension、Dexie |
| 2 静态建议原型 | ✅ | 假数据、Decoration、双向定位、筛选、接受/忽略、过期 |
| 3 LLM 审阅 | ✅ | `/api/review`、provider adapter、防注入 prompt、真实 DeepSeek 验证 |
| 4 版本安全与批量修改 | ✅ | ChangeSet 预处理/重叠剔除/批量应用/撤销快照、ChangeSetPreview |
| 5 上下文聊天 | ✅ | `/api/chat`、`/api/change-set`、ContextChat、按意见生成修改集 |
| 6 产品化整理 | ✅ | Playwright E2E、键盘快捷键、无障碍收尾、README 部署说明 |
| 7 界面优化 | ✅ | 主题切换按钮、设置面板（中央模态）、数据 Tab |
| 8 界面美化 | ✅ | 绿色设计令牌、纸张式编辑器、胶囊筛选器、对话气泡、全局过渡动画 |
| 9 档位四档化 + 配置预设 | ✅ | 档位改 auto/off/low/high/max、LLM 配置按命名预设组织 |
| 10 左侧对话历史 | ✅ | ChatGPT 式历史（宽屏常驻左栏 / 窄屏抽屉）、IndexedDB 持久化、刷新恢复 |

**质量基线（最近一次全量验证）：** 107 个 Vitest 用例（15 文件）+ 23 个 Playwright 用例全过；
`typecheck` / `lint`（0 问题）/ `build` 全通过。

> ⚠️ **工作区有未提交改动**：`plan/` 目录重组、版本号与页脚隐私说明、浮动按钮下移、
> 页脚移除 `revision`、以及阶段 10 的对话历史。按 AGENTS.md 的「Git 操作」约定，
> **commit / push 必须先获得用户明确同意**，不要自己提交。

---

## 三、本机环境（交接用）

- `.env.local` 已配好密钥（git 忽略），当前 `LLM_MODEL=deepseek-flash`。
- 开发服务器跑在 http://localhost:3000 （`npm run dev`）。
- 真实 DeepSeek 链路已跑通：审阅返回三层建议、侧栏↔正文双向定位、单条接受改正文、
  对话生成修改集并预览接受。
- E2E 用**系统安装的 Google Chrome**（`channel: "chrome"`），不是 Playwright 下载的 chromium
  ——本机缺后者所需的系统依赖。E2E 会 mock 掉 LLM，**不消耗 API 额度**。

---

## 四、下一步

第四节的两条窄屏抽屉待办（遮罩点击关闭、开合过渡动画）已完成并实测通过，
当前无其他已知待办。接手后先跑一遍基线确认是绿的：`npm run test`（107 个）
与 `npm run test:e2e`（23 个，自动起 dev server）。继续扩展的方向见 PLAN 第 18 节；
PLAN 明确的非 MVP 范围见 AGENTS.md「不要做的事」。

## 五、接手建议

1. 先跑一遍基线确认是绿的：`npm run test`（107 个）与 `npm run test:e2e`（23 个，自动起 dev server）。
2. **动代码前读 [AGENTS.md](./AGENTS.md)**，尤其是「必须遵守的核心约束」「界面开发约定」
   「浮动按钮与页面底部布局」「已知陷阱」——里面记着这个项目已经踩过的 14 个坑，
   其中好几个是"看起来像 bug、其实是有意为之"的取舍。
3. 改完按 AGENTS.md 收尾：跑 `typecheck` / `lint` / `test`，必要时加 `test:e2e`；
   **提交前先征得用户同意**。
