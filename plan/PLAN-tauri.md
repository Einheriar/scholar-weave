# Tauri 打包迁移计划

> 状态：阶段 0 进行中（装依赖）
> 创建：2026-09-23
> 背景：README/PLAN 的演进方向，发布版用 Tauri 打包成本地 Windows 应用，浏览器版保留作开发载体。

## 已确认的决策

- **LLM 调用走选项 1（直连）**：`src/lib/llm/` 逻辑搬到前端，Tauri 下用 `@tauri-apps/plugin-http`（Rust reqwest 发出，绕过 CORS）直连 OpenAI 兼容 API。Key 仍存 localStorage。Next.js 服务端路由保留给浏览器版，不删。
- **保留双轨**：同一个 `src/` 同时支持 Vite（Tauri 开发路径）和 Next.js（浏览器开发路径）。`npm run dev` 切成 Vite，`npm run dev:next` 保留 Next。
- **发布路径 = Tauri**，浏览器版 = 开发/调试载体。
- **E2E 降级**：Playwright `channel: "chrome"` 对 Tauri 窗口无效，关键场景转手工回归 checklist 写进 `DEVELOPMENTER.md`，tauri-driver 重建留作后续可选任务。

## 阶段 0：Vite 基础设施

目标：`npm run dev` 起 Vite（5173），产品行为与 Next 版（3000）一致，Vitest 320 全绿。不改任何产品逻辑。

- [ ] 0.1 装依赖：`vite`、`@vitejs/plugin-react`、`@tailwindcss/vite`、`vite-tsconfig-paths`；移除 `@tailwindcss/postcss` + 删 `postcss.config.mjs`
- [ ] 0.2 新建 `vite.config.ts`：react + tailwindcss + tsconfig-paths 插件；`server.port: 5173 strictPort`；`build.target: chrome105`；`envPrefix: ['VITE_', 'TAURI_ENV_*']`
- [ ] 0.3 新建 `index.html`：把 `layout.tsx` 的 `<html lang="zh-CN">`、三个字体变量、`suppressHydrationWarning`、主题恢复内联脚本原样搬过来
- [ ] 0.4 字体：三个 woff2 从 `src/app/fonts/` 复制到 `public/fonts/`，`globals.css` 用 `@font-face` + `url('/fonts/...')` 声明（替代 next/font/local），`--font-misans` / `--font-inter` / `--font-geist-mono` 三个 CSS 变量名不变，下游零改动
- [ ] 0.5 新建 `src/main.tsx`：`createRoot(...).render(<StrictMode><Page /></StrictMode>)`，从 `src/app/page.tsx` 导入
- [ ] 0.6 新建 `src/vite-env.d.ts`：`/// <reference types="vite/client" />`
- [ ] 0.7 `package.json` scripts：`dev` → `vite`，新增 `dev:next: next dev`，`build` → `vite build`，保留 `build:next`，加 `tauri`
- [ ] 0.8 `tsconfig.json`：`include` 去掉 `.next/**`，加 `vite.config.ts` / `src/vite-env.d.ts`；删 `plugins: [{name: "next"}]`
- [ ] 0.9 `vitest.config.mts`：`exclude` 里 `.next/**` → `dist/**`，其余照搬

验证：5173 外观/交互与 3000 一致；test 全绿；typecheck 零报错；`npm run build` 出 `dist/`；`dev:next` 正常。

## 阶段 1：抽出纯函数 LLM 核心

目标：5 个 route 的纯逻辑（Zod 校验、规模限制、锚点过滤、ID 生成、结构化重试）从 Next 依赖剥离，Next 路由和 Tauri 前端共用。

- [ ] 1.1 `server-helpers.ts` 拆分：`callLLMStructured` 纯函数版移到 `src/lib/llm/llm-core.ts`（`request: Request` → 可选 `AbortSignal`，返回值去 `NextResponse`）；`apiError`/`extractJson`/`buildRepairMessages` 一并搬走；`server-helpers.ts` 变薄包装
- [ ] 1.2 `review-core.ts`：抽 `processReviewRequest(body)`（MAX_BLOCKS/MAX_TOTAL_CHARS、locateInText 过滤、ID 生成、ReviewItemSchema 校验）；`review/route.ts` 只做 parse/safeParse/包响应
- [ ] 1.3 同样处理 `chat-core.ts`、`change-set-core.ts`、`models`、`test-connection`
- [ ] 1.4 `openai-provider.ts`：fetch 包 `httpFetch` 适配器，`src/lib/platform.ts` 判断 Tauri → plugin-http fetch；代理参数映射到 plugin-http `proxy` 选项（SOCKS5 开 cargo `socks` feature）

验证：test + typecheck 全绿，route 对外契约不变。

## 阶段 2：Tauri 壳

- [ ] 2.1 `npm install -D @tauri-apps/cli` + `npm install @tauri-apps/api` + `npx tauri init`
- [ ] 2.2 `npm run tauri add http`
- [ ] 2.3 `tauri.conf.json`：`identifier: com.supergrammarly.app`；`productName: superGrammarly`；窗口 1200×800 min 900×600；`targets: ["nsis"]`；`webviewInstallMode: downloadBootstrapper + silent`
- [ ] 2.4 `Cargo.toml`：`tauri-plugin-http` 加 `features = ["socks"]`
- [ ] 2.5 `capabilities/default.json`：http scope 放行 `https://*` + `http://*`（用户可自填任意 baseURL）
- [ ] 2.6 `npx tauri icon`（以现有 favicon 或 1024×1024 图为源）

## 阶段 3：前端在 Tauri 下的调用切换

- [ ] 3.1 `src/lib/api-client.ts`：暴露 `callReview` / `callChat` / `callChangeSet` / `fetchModels` / `testConnection`；Tauri → 直接调 `*-core.ts`；浏览器 → fetch `/api/*`（现状）
- [ ] 3.2 替换 5 处 fetch 调用点：page.tsx ×3、ModelInput.tsx ×1、SettingsPanel.tsx ×1
- [ ] 3.3 错误结构统一：Tauri 分支包成与浏览器 fetch 失败一致的 shape，page.tsx 现有 `data?.error?.message` 不改

验证：test 全绿；浏览器版行为不变；`tauri dev` 里审阅/对话/修改集/模型联想/测试连接五流程通真实 LLM。

## 阶段 4：打包与文档

- [ ] 4.1 `npm run tauri build` 出 NSIS 安装包，干净环境验证双击安装 + 运行
- [ ] 4.2 `AGENTS.md` 更新：发布路径 = Tauri；`*-core.ts` 是双轨共用唯一 LLM 逻辑来源；改 LLM 行为必须同时考虑两个分支
- [ ] 4.3 `DEVELOPMENTER.md` 加 Tauri 开发/打包/排错章节
- [ ] 4.4 E2E 现状记录：Playwright 对 Tauri 无效，关键场景转手工 checklist 写进 `DEVELOPMENTER.md`

## 风险与回退

- 阶段 0/1 任何一步出问题，git 历史有干净状态，随时 revert 单个 commit。
- plugin-http 代理已确认源码支持（per-request `proxy` → reqwest Proxy），SOCKS5 + 认证代理需真实环境实测。
- WebView2 与 Chrome 行为基本一致，剪贴板/字体渲染可能有细微差别，发布前手工过关键页面。
- Tauri 版不再需要用户装 Node（区别于现有 package:app 方案）。

## 不做的事

- 不改 `src/app/api/*` 对外行为（Next 路由继续服务浏览器版）
- 不动 Zod schema / Dexie 存储结构 / 任何 UI 组件
- 不重建自动化 E2E（手工 checklist 过渡）
