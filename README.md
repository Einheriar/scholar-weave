# superGrammarly

本地优先、Web 优先的 AI 文档审阅工作台。把长文本交给 LLM 检查语病、清晰度和行文质量，审阅结果以“全文意见 / 段落意见 / 局部修改”三层形式绑定到原文位置，所有修改必须先预览、再由用户逐条确认后才会应用。

完整的产品定义、技术设计与实施计划见 [PLAN.md](./PLAN.md)；实现约定、踩坑记录与设计取舍见 [AGENTS.md](./AGENTS.md)；当前进度与交接状态见 [HANDOFF.md](./HANDOFF.md)。

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

产物在 `dist/`（约 70 MB）：

```text
dist/
├─ app/            Next.js 服务本体，自带依赖，只需要系统有 Node
│  └─ .env.local   密钥配置（打包时从项目根目录复制）
├─ start.mjs       跨平台启动器（起服务 + 打开浏览器）
├─ start.cmd       Windows 双击入口
└─ start.sh        Linux/macOS 双击入口
```

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
| 界面能打开但审阅报错 | 检查 `dist/app/.env.local` 是否存在、密钥是否正确。 |

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

- 用户文档草稿仅保存在**本浏览器**的 IndexedDB，不会上传到本服务之外。
- 点击“开始审阅”或发送对话后，**相关文档内容会发送给所配置的 LLM 供应商**（当前为 DeepSeek）用于生成结果。
- 服务端默认不记录正文日志；API Key 只在服务端环境变量中。
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
- **设置面板**（左下角齿轮）— 模型（命名预设：同一提供商可存多个 Key，切换配置不互相覆盖）、
  审阅偏好（写作风格、保留术语、自定义指令）、数据（载入样例、清空数据）三个 Tab。
- **界面** — 深浅色主题切换、键盘快捷键（`Cmd/Ctrl+Enter` 审阅、`Cmd/Ctrl+Shift+C` 复制全文）、
  屏幕阅读器播报与键盘可达。

后续阶段进度与当前测试基线见 [HANDOFF.md](./HANDOFF.md)。
