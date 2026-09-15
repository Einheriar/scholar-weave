# 交接说明（HANDOFF）

> **这是一个临时文件。** 只在需要别的 agent / 开发者接手时存在，写完当前进度、本机环境、
> 下一步就够了——交接完成后它的内容可以被覆盖或删除。
>
> 长期有效的知识**不属于这里**：
> - 实现约定、踩坑记录、设计取舍 → [AGENTS.md](./AGENTS.md)
> - 项目是什么、怎么跑、怎么部署 → [README.md](./README.md)
> - 产品定义与实施计划 → [PLAN.md](./PLAN.md)
> - 短期任务清单 → [TODO.md](./TODO.md)

## 当前状态

**阶段 0–9 全部完成，无阻塞。** PLAN 定义的阶段 0–6 均已落地；阶段 7–9（界面优化、
界面美化、思考档位四档化 + 模型配置预设）是在 PLAN 之外追加的迭代。

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
| 9 档位四档化 + 配置预设 | ✅ | 档位改 auto/off/low/high/max、LLM 配置按命名预设组织、修两个 UI 问题 |

**质量基线（最近一次全量验证）：** 85 个 Vitest 用例（12 文件）+ 15 个 Playwright 用例全过；
`typecheck` / `lint`（0 问题）/ `build` 全通过。

近期提交（新→旧）：`71effc4` 文档重组 · `eaeb7be` 修整页宽度 · `780599d` 文档 ·
`e6282cf` 阶段 9 功能 · `14c4251` 阶段 8 美化。

## 本机环境（交接用）

- `.env.local` 已配好密钥（git 忽略），当前 `LLM_MODEL=deepseek-flash`。
- 开发服务器跑在 http://localhost:3000 （`npm run dev`）。
- 真实 DeepSeek 链路已跑通：审阅返回三层建议、侧栏↔正文双向定位、单条接受改正文、
  对话生成修改集并预览接受。

## 下一步

- **没有待办或已知 bug。** 继续做的话，方向见 PLAN 第 18 节演进方向；非 MVP 范围见
  AGENTS.md「不要做的事」。
- 接手时建议先跑一遍 `npm run test` 与 `npm run test:e2e` 确认基线是绿的（E2E 会自动起 dev server，
  mock 掉 LLM，不消耗额度），再动代码。
- 已知的取舍（代理、档位 clamp 映射表、批量撤销按钮等）都不算缺陷，理由见 AGENTS.md。
