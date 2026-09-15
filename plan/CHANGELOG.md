# 变更记录（CHANGELOG）

本文件记录项目的重要变更，条目与 git 提交一一对应（附短 hash 便于回溯），按里程碑分组、
组内按提交先后排列。日期取自提交的 author date（本仓库历史提交均为 2026-09-15）。

- 阶段划分见 [PLAN.md](./PLAN.md)（阶段 0–6）与 [../HANDOFF.md](../HANDOFF.md)（含追加的阶段 7–9）。
- 这里的条目从提交历史整理而来，只保留对使用者/开发者有意义的变化，不逐字复述提交信息。
- 新增改动请追加到「后续变更」一节；若改动规模已够一个里程碑，可在底部另开一节。

## 立项与阶段 0–6：MVP 落地

- `67aae37` docs: 项目计划定稿（PLAN.md）
- `7496623` chore: 阶段 0 项目初始化
- `f60aff9` feat: 阶段 1 编辑器与稳定段落
- `9d4f52c` feat: 阶段 2 静态建议原型（假数据验证 Grammarly 式交互）
- `4ae3b0b` feat: 阶段 3 接入真实 LLM 审阅（DeepSeek）
- `5bf98c0` feat: 阶段 4 版本安全与批量修改 + 阶段 5 上下文聊天 + 阶段 6 产品化
- `d458a45` test: `/api/chat` 端点测试（answer / answer_with_changes 形态、修改集待预览、定位剔除、校验与超长）
- `9339e4a` fix: 单条建议撤销时还原正文 + 编辑器批量应用/撤销测试
- `d040502` feat: 阶段 6 产品化整理（Playwright E2E + 快捷键 + 无障碍 + 部署文档）
- `d650701` docs: 交接说明（HANDOFF.md）
- `155fdc4` feat: 本地双击启动的打包方式（`npm run package:app`）
- `0ee2316` fix: 打包脚本与启动器的跨平台问题
- `4e65128` fix: E2E 剪贴板用例兼容 Windows 剪贴板的 CRLF 换行

## 阶段 7：界面优化

- `f1ba106` feat: 顶栏手动切换深浅色模式
- `3f7c770` docs: 新增 TODO.md 任务清单
- `3fbf311` docs: README 补充「新环境先跑一次构建生成 Next 类型文件」的说明
- `675a811` feat: 主题切换改为左下角浮动 SVG 图标按钮，加审阅 API debug 日志
- `865cebf` feat: 设置面板（API Key / 模型 / 思考档位 + 自定义提示词），localStorage 持久化
- `533b78f` docs: 记录用户配置 API Key 明文存储的安全注意事项
- `0ea505d` feat: 设置面板改为中央模态窗口，支持 Esc 关闭和点击遮罩关闭
- `b1e90f4` feat: 设置面板全面中文化
- `7cba7bb` feat: 载入样例和清空数据移到设置面板的数据 Tab
- `bf0746b` docs: 更新 HANDOFF.md 记录阶段 7 界面优化完成

## 阶段 8：界面美化

- `14c4251` feat: Grammarly 式绿色设计令牌 + 纸张式编辑器 + 胶囊筛选器 + 对话气泡 + 全局过渡动画
- `d42a0df` feat: 自定义下拉组件替换所有原生 `<select>` + 文档标题宽度固定

## 阶段 9：思考档位四档化 + 模型配置预设

- `9185115` docs: 阶段 9 交接文档（当时代码尚未验证提交）
- `e6282cf` feat: 思考档位改为 auto/off/low/high/max + LLM 配置改为命名预设（切换不丢 Key）
  - 顺带把 `resolveThinkingParam()` 提取到协议层 `src/lib/llm/thinking.ts`（服务端与前端共用），
    并修掉设置面板里下拉被 `overflow-y-auto` 容器裁切的问题（改为 portal + `fixed` 定位 + 自动上翻）
- `709f1ff` docs: 记录阶段 9 的 commit hash

## 缺陷修复

- `780599d` docs: 记录 Select 改为 portal 后对测试选择器的影响（`getByRole("listbox")` 要从根找）
- `eaeb7be` fix: 整页宽度随正文内容变化——`<main>` 补 `w-full`，修正 flex 交叉轴上 `auto` 外边距
  导致整页按 fit-content 定宽的问题（表现为同一窗口宽度下输入框宽度不稳定）

## 文档与仓库约定

- `71effc4` docs: 交接文件合并为单份 HANDOFF.md（删除阶段分册），并把规则写进 AGENTS.md
- `a3b9cf5` docs: 按「HANDOFF 临时 / AGENTS + README 永久」重组文档职责
- `491ad0e` docs: 规定 commit / push 需先获得用户许可
- `—`       docs: 新建 `plan/` 目录，将 PLAN.md 移入，并新增本变更记录

## 后续变更

- `—` feat: 页脚展示标准版本号 `v0.1.0`（唯一来源 `package.json`，经 `next.config.ts` 构建时注入；
  新增 `src/lib/version.ts` 与 `tests/version.test.ts`）
- `—` docs: 页脚隐私说明更新——供应商由用户在设置面板中选择，不再是固定的 DeepSeek；
  并说明自填的 API Key 明文存在浏览器 localStorage（README 同步）
- `—` fix: 页脚左下角被浮动按钮/开发指示器遮挡，此前 `revision` 首字符一直被盖住
- `—` feat: 左下角两个浮动按钮下移到真正的底部（设置 `bottom-28`→`bottom-16`、主题 `bottom-16`→`bottom-4`），
  页脚改为 `pl-12` 常驻让位、元信息行恢复左对齐
- `—` chore: 关闭 Next 开发指示器（`devIndicators: false`）——四角实测均会遮挡界面，
  且本项目无静态化排查需求；恢复方式见 AGENTS.md
- `—` fix: 页脚移除 `revision N`（它是"每敲一个字符 +1"的计数器，易被误读为版本号，
  且不驱动任何界面行为）；页脚只保留 `v0.1.0` 与段数
- `—` docs: README 隐私说明补充「每次具体发送什么」——审阅发全文、对话按上下文发该段+相邻段、
  历史只带最近 8 轮且不含正文；并说明本地只保留一份草稿、无历史版本
- `—` feat: 左侧对话历史（ChatGPT 式）——新增 `Conversation`/`ChatTurn` schema、`src/lib/chat-history.ts`
  纯函数、Dexie `conversations` 表（库结构升到 v2，实例抽到 `src/lib/storage/db.ts`）与
  `ChatHistory` 组件；宽屏（≥1280px）常驻左栏、窄屏汉堡抽屉；发送消息时落库、刷新后自动接上最近一条，
  「清空对话」改为「新对话」（保留已保存记录），单条可删除；配套 20 个 Vitest + 8 个 Playwright 用例
