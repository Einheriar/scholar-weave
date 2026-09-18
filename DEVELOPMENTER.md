# superGrammarly

本地优先、Web 优先的 AI 文档审阅工作台。把长文本交给 LLM 检查语病、清晰度和行文质量，审阅结果以“全文意见 / 段落意见 / 局部修改”三层形式绑定到原文位置，所有修改必须先预览、再由用户逐条确认后才会应用。

完整的产品定义、技术设计与实施计划见 [plan/PLAN.md](./plan/PLAN.md)；变更记录见 [plan/CHANGELOG.md](./plan/CHANGELOG.md)；实现约定、踩坑记录与设计取舍见 [AGENTS.md](./AGENTS.md)；当前进度与交接状态见 [plan/HANDOFF.md](./plan/HANDOFF.md)。

### 关于 `plan/` 目录

项目根目录下的 [`plan/`](./plan) 专门存放**计划、变更记录与短期任务清单**，不参与构建：

| 文件 | 内容 |
|------|------|
| [plan/PLAN.md](./plan/PLAN.md) | 产品定义、技术设计与实施计划的定稿（阶段划分的原始依据） |
| [plan/CHANGELOG.md](./plan/CHANGELOG.md) | 变更记录，条目对应 git 提交，按里程碑分组 |
| [plan/TODO.md](./plan/TODO.md) | 当前短期任务清单 |
| [plan/archive/](./plan/archive) | 已完成的方案与讨论文档归档 |

新增计划类文档、或改动达到一个里程碑时，都追加到这个目录里。

## 技术栈

- Next.js 16 (App Router, Turbopack) + TypeScript + React 19
- Tiptap 3 编辑器（Decoration 实现建议标记，不污染正文）
- Zod 作为运行时数据协议的唯一来源
- Dexie (IndexedDB) 本地持久化
- Vitest + Testing Library（单元/集成测试）
- Playwright（端到端测试）
- LLM：OpenAI 兼容协议，当前默认接入 DeepSeek

## 本地运行

```bash
npm install
cp .env.example .env.local   # 然后填入密钥
npm run dev                  # http://localhost:3000
```

打开页面会恢复最近一次编辑的草稿；没有草稿时自动载入内置样例。也可以打开左下角「设置」→ 数据 Tab → 「载入样例」随时复位。点「开始审阅」会调用真实 LLM。

### 环境变量

密钥只存在于服务端环境变量（`.env.local`，已被 git 忽略），**不会**打包进前端代码，也不会写入浏览器存储。可用变量见 [.env.example](./.env.example)：

| 变量 | 说明 |
|------|------|
| `LLM_PROVIDER` | 目前只实现 `openai`（OpenAI 兼容协议） |
| `OPENAI_API_KEY` | 供应商密钥 |
| `OPENAI_BASE_URL` | 兼容接口 base URL。DeepSeek 为 `https://api.deepseek.com`；用官方 OpenAI 时留空 |
| `LLM_MODEL` | 模型名。DeepSeek 可用 `deepseek-flash`、`deepseek-v4-pro` |

> 注意：`deepseek-flash` 等推理模型会消耗 reasoning token。若审阅返回空结果（`finish=length`），需要提高 `/api/review` 的 `max_tokens`（当前 16000）。

## 版本号

应用版本号只维护一个地方：`package.json` 的 `version`（当前 `0.1.0`）。构建时由 `next.config.ts`
读取并以 `NEXT_PUBLIC_APP_VERSION` 内联给前端，页脚左下角以 `v0.1.0` 形式展示。

发版只需改 `package.json` 的 `version`（必要时重跑 `npm run build`），不要在页面里硬编码版本号。
`tests/version.test.ts` 会检查注入值确实来自 `package.json` 且符合 `v<major>.<minor>.<patch>` 格式。

## 常用命令

```bash
npm run dev        # 开发服务器
npm run typecheck  # tsc --noEmit
npm run lint       # ESLint
npm run test       # Vitest（单元/集成）
npm run test:e2e   # Playwright（端到端）
npm run build      # 生产构建
npm start          # 启动生产服务器
npm run package:app # 打包成可双击启动的本地应用（见下）
```

> **刚拿到源码（新克隆 / 解压 zip）时，先跑一次 `npm run build` 或 `npm run dev`。**
> Next 会在构建时生成类型文件（`next-env.d.ts` 与 `.next/types/`），它们被 git 忽略、不在源码包里。
> 少了它们，`npm run typecheck` 会报 `Cannot find name 'LayoutProps'`——这是缺生成物，不是代码有问题。
> 跑一次构建即可恢复。

### 端到端测试

```bash
npm run test:e2e
```

`playwright.config.ts` 会自动启动 `npm run dev`（已存在服务时复用）。E2E 用例会拦截 `/api/review`、`/api/chat`，用固定响应验证前端接线，**不需要 API Key，也不消耗模型额度**。

本机配置说明：用例使用系统安装的 Google Chrome（`channel: "chrome"`），而不是 Playwright 下载的 chromium——下载构建所需的系统依赖在本机不可用。若在别处运行，可先 `npx playwright install --with-deps chromium` 再改用默认浏览器。

## 打包成可双击启动的本地应用

日常使用不必每次开终端跑 `npm run dev`。可以打成一个自包含目录，双击启动、自动开浏览器：

```bash
npm run package:app
```

产物在 `dist/`（Windows x64 当前约 35 MB）：

```text
dist/
├─ app/            Next.js 服务本体，自带依赖，只需要系统有 Node
│  └─ .env.local.example   服务端默认配置模板（公开分发包不含真实密钥）
├─ start.mjs       跨平台启动器（起服务 + 打开浏览器）
├─ start.cmd       Windows 双击入口
└─ start.sh        Linux/macOS 双击入口
```

公开分发时使用 `npm run package:app -- --without-env`，避免把本机 `.env.local` 复制进产物。用户可以直接在网页的“设置 → 模型”中填写 API Key；只有需要服务端默认配置时，才需要根据模板创建 `dist/app/.env.local`。

启动方式：

- **Windows**：双击 `dist\start.cmd`（或在该目录执行 `node start.mjs`）
- **Linux / macOS**：`./dist/start.sh`（或 `node dist/start.mjs`）

关掉窗口即停止服务。草稿存在浏览器本地，换端口或换浏览器不会丢，但不同浏览器之间互不可见。

### 排错

| 现象 | 原因与处理 |
|------|-----------|
| 提示“需要 Node.js 20.9 或更高版本” | Next 16 的最低要求。装 LTS 版 Node 后重试。 |
| 提示“端口 3000 已被占用” | 已有服务在跑，或别的程序占了。换端口：Windows `set PORT=3200 && node start.mjs`，Linux/macOS `PORT=3200 node start.mjs`，然后访问 http://localhost:3200 |
| Windows 双击后窗口一闪而过 | 多半是没装 Node 或没加进 PATH。脚本会检查并提示；若仍一闪而过，就在该目录开 PowerShell 执行 `node start.mjs` 看完整报错。 |
| 提示“未能自动打开浏览器” | 只是自动打开失败，服务已跑起来，手动访问提示里的地址即可。 |
| 界面能打开但审阅报错 | 检查网页“设置 → 模型”中的配置；若使用服务端默认配置，再检查 `dist/app/.env.local` 是否存在、密钥是否正确。 |

改端口的另一种方式：直接编辑 `start.mjs` 里 `const port = Number(process.env.PORT || 3000)` 的默认值。

### 关于在 Windows 上使用

流程：把项目源码拷到 Windows → 装好 Node.js（20.9+，[下载](https://nodejs.org/)，安装包默认会把 node 加进 PATH）→ 在项目目录执行 `npm install` → `npm run package:app`。之后日常双击 `dist\start.cmd` 即可，不需要再碰 npm，也不需要联网装依赖。

**注意：把本机（Linux）打好的包直接拷到 Windows 是用不了的。** 打包产物里带平台专属的原生二进制（图片优化用的 `sharp`，Linux 版是 `@img/sharp-linux-x64`），在 Windows 上无法加载。必须换到 Windows 重新打一次。

如果连 Node 也不想在 Windows 上装，可以给产物再套一层 Node 单文件运行时（`node --experimental-sea-config` 打包或 `pkg`），把 `node.exe` 和 `app/` 放一起，让启动器调用自带的 `node.exe`。这属于额外的分发工作量，本项目没有预置。

## 部署

本地个人使用直接在本机跑 Next 服务即可。

若部署到公网，**必须**先补上（PLAN 8.3）：

1. 身份验证——否则任何人都能消耗你的 API 额度。
2. 请求限流与用量控制。
3. 密钥仅保留在服务端环境变量中。

```bash
npm run build
npm start          # 默认 http://localhost:3000
```

## 隐私与数据发送

- 用户文档草稿与**对话历史**仅保存在**本浏览器**的 IndexedDB，不会上传到本服务之外。
  **草稿只保留最近一份、每次自动保存以覆盖方式写入，不保留历史版本**（所以没有「撤回历史版本」功能；正文右上角的撤销按钮与 `Ctrl+Z` 等价，也只能回溯当前文章的当前会话）；
  对话历史则按条保存、可以留多条随时切回，设置面板「数据 → 清空数据」会与草稿一起清掉。
- 点击“开始审阅”或发送对话后，**相关文档内容会发送给当前配置的 LLM 供应商**用于生成结果。
  供应商由你自己指定：在设置面板里填 API Key / Base URL / 模型（可保存多套命名预设、随时切换）；
  没有填就退回服务端 `.env.local` 里的默认配置（默认是 DeepSeek 端点）。**换供应商就换了数据接收方**，
  审阅敏感内容前请确认当前配置。
- **每次具体发送什么**（实测请求体）：
  - 「开始审阅」→ 发送**当前全文**（所有段落）。
  - 对话 → 按当前上下文发送：**全文**上下文发全部段落；选中某段或某条建议时，只发**该段 + 相邻段落**；
    选中一段文字提问时，额外带上这段选区文本。
  - 对话历史只带**最近 8 轮问答的纯文本**，**不含文档正文**（正文以本次 `blocks` 为准，避免重复上传）。
    注意这里指的是**当前这一条对话**的最近 8 轮：左侧历史记录里的其他对话不会一起发出去。
  - 因此：你**修改后新发起的请求只包含修改后的正文**，改掉的内容不会作为"历史正文"一起发出去；
    但如果之前某轮问答里贴过某段文字，那段文字会留在对话历史里并随最近 8 轮一起发送。
- 服务端默认不记录正文日志；服务端密钥只存在环境变量里，不会打包进前端代码。
- ⚠️ 若在设置面板里填了自己的 API Key，它**以明文保存在本浏览器 localStorage**，能打开 DevTools
  的人就能看到。这只适合个人本地使用，公开部署前必须先解决（见 [AGENTS.md](./AGENTS.md) 的安全注意）。
- 文档内容在 prompt 中按不可信数据包裹，其中的指令性文本不会被当作系统指令执行。

## 实现约束

实现时必须遵守的核心约束——不信任 LLM 字符坐标、稳定 block ID、严格区分 `opinion` 与 `edit`、
LLM 未经确认不改正文、防注入、密钥只在服务端——统一维护在 [AGENTS.md](./AGENTS.md)，
改动前请先读那一节。

## 已实现的功能

- **编辑与持久化** — Tiptap 自然段编辑器；稳定段落 ID（普通编辑保留、拆分保留前半段、合并保留目标段）；
  草稿自动存入 IndexedDB，刷新即恢复。
- **LLM 审阅** — 一次审阅产出「全文意见 / 段落意见 / 局部修改」三层建议，绑定到原文位置；
  侧栏与正文可双向定位；逐条接受、忽略、撤销；正文改动后无法定位的建议自动标记「过期」。
- **批量修改** — 意见可生成 ChangeSet：先看差异预览，再逐条或批量确认；接受后可用编辑器 `Ctrl+Z` 撤销。
- **上下文对话** — 以当前选区 / 选中的建议 / 段落 / 全文作为上下文提问；回复带修改集时同样先预览、再由你确认。
- **对话历史**（ChatGPT 式）— 左侧列出历史对话（标题取首条消息，附相对时间与消息数），点一条即可切回；
  宽屏常驻左栏，窄屏用顶栏「三条横线」按钮拉出抽屉。发送第一条消息时自动保存到本地，
  刷新后自动接上最近一条对话。「新对话」只清空当前界面，已保存的记录留在列表里随时可取；
  单条可删除（会先确认）。
- **设置面板**（左下角齿轮）— 模型（命名预设：同一提供商可存多个 Key，切换配置不互相覆盖）、
  审阅偏好（写作风格、保留术语、自定义指令）、数据（载入样例、清空数据）三个 Tab。
- **界面** — 深浅色主题切换、左侧对话历史、键盘快捷键（`Ctrl+Enter` 审阅、`Ctrl+Shift+C` 复制全文）、
  屏幕阅读器播报与键盘可达。

后续阶段进度与当前测试基线见 [plan/HANDOFF.md](./plan/HANDOFF.md)。
