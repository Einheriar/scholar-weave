# 打包方案讨论：从「需装 Node」到「完全绿色软件」

> 讨论时间：2026-09-16
> 参与：用户 + AI
> 背景：当前 `npm run package:app` 打包产物约 70MB，但要求目标机器预装 Node.js 20.9+，且不含浏览器。用户希望做成「完全不需要装 Node 的绿色软件」。

---

## 现状（已有方案）

`npm run package:app` 产物结构：

```
dist/
├─ app/            ← Next.js standalone 服务（自带 node_modules，依赖系统 Node）
│  └─ .env.local   ← API 密钥（打包时自动复制）
├─ start.mjs       ← 跨平台启动器（起服务 + 打开浏览器）
├─ start.cmd       ← Windows 双击入口
└─ start.sh        ← Linux/macOS 双击入口
```

**限制：**
- 目标机器必须装 Node.js 20.9+（Next.js 16 硬性要求）
- 不带浏览器：启动后调系统默认浏览器打开 `http://localhost:3000`
- 不能跨平台打包：`sharp` 图片优化库是平台专属原生二进制，必须在目标操作系统上打包

---

## 方案对比

### 方案 A：Node SEA（单文件可执行）— 不推荐

**原理**：用 Node 官方 Single Executable Application 把 `node.exe` 和 JS 代码焊成单 `.exe`。

**现状（2026-09）：**
- Node v25.5+ 内置 `node --build-sea`，不再需要外部工具 `postject`
- Node 20–24 用 `--experimental-sea-config` + `postject`（legacy，仍可用）

**对 Next.js 的坑：**

| 坑 | 原因 |
|---|---|
| 必须先打成单文件 | SEA 里 `require()` 只能加载内置模块，读不了文件系统 |
| Next.js 很难单文件化 | 运行时动态读 `.next/` 目录的 manifest、路由映射，依赖 `public/` 和 `.next/static/` |
| `sharp` 原生模块没法直接焊 | 只能当资源打包，运行时解压到临时目录再用 `process.dlopen()` 手动加载；跨平台已知会崩 |
| 资源文件要手动管理 | `.env.local`、静态资源全得用 SEA `assets` API 或解压到临时目录 |
| 动态 require 容易漏 | Next.js 内部有几十个（`server-only`、`instrumentation`、optional deps） |

**结论**：理论可行，但工程量大、脆、维护痛苦。

---

### 方案 B：成熟打包工具（postjs / caxa）

#### B1. postjs（https://github.com/post-js/postjs）

- 自动把 `node.exe` + 代码 + node_modules（含原生 `.node`）打成单文件或便携目录
- 支持 Next.js standalone 输出
- **体积预估**：120–180MB（含 node.exe 本身）

#### B2. caxa（https://github.com/leafac/caxa）

- 自解压目录：双击时解压到临时目录再启动
- 优点：实现简单，兼容性好（解压后就是普通 Node 环境）
- 缺点：首次启动稍慢；临时目录可能被清理
- **体积预估**：同 postjs，约 120–180MB

#### B3. pkg（已停止维护）

Vercel 已弃更，对 Node 20+ 和新版 Next.js 支持不好，**不建议**。

---

### 方案 C：Tauri / Electron 桌面应用框架（用户倾向）

把「浏览器」也一起打包，做成真正的桌面软件（独立窗口，不依赖系统浏览器）。

| 框架 | 体积 | 原理 | 适合度 |
|---|---|---|---|
| **Tauri** | 安装包 **10–20MB** | 用系统自带 WebView2（Windows）/ WebKit（macOS）渲染，Rust 写壳 | ✅ 最适合本项目 |
| **Electron** | **80–150MB** | 自带完整 Chromium | 对本项目太重 |

**Tauri 具体做法（两种路线）：**

1. **静态导出路线**（推荐但有限制）
   - 把 Next.js 改成纯静态导出（`next build && next export`）
   - 问题：App Router 对纯静态支持有限，API 路由（`/api/review`、`/api/chat`）没法静态化
   - 需要把 API 逻辑移到 Tauri 的 Rust 端，或用 Rust 起 HTTP 服务代理到内嵌的 Next.js standalone

2. **内嵌服务路线**（更实际）
   - Tauri Rust 壳启动时调起 Next.js standalone 服务（内嵌 Node）
   - 在内嵌 WebView 里打开 `http://localhost:3000`
   - 数据存储：浏览器 IndexedDB 换成 SQLite 或 Rust 端存储
   - 本质上是「套壳」，但用户感知是独立桌面应用

**注意**：这不再是「打包现有 Next.js 应用」，而是**重写桌面层**。工作量是几天级别，不是几小时。

---

## 决策

**用户倾向：方案 C（Tauri）**

理由：
- 最终安装包最小（10–20MB vs 120–180MB）
- 真正的桌面应用体验：独立窗口、任务栏图标、自动更新
- 不依赖用户装 Node 或浏览器

---

## 下一步（未执行）

- [ ] 调研 Tauri + Next.js App Router 的具体整合方案（静态导出 vs 内嵌服务）
- [ ] 确认 API 路由（`/api/review`、`/api/chat`）在 Tauri 中的实现方式（Rust 重写 vs 代理到内嵌 Node）
- [ ] 确认数据存储迁移方案（IndexedDB → SQLite）
- [ ] 评估 Windows WebView2 的兼容性（Windows 10/11 预装，但旧版可能需引导安装）
