# superGrammarly

本地优先、Web 优先的 AI 文档审阅工作台。把长文本交给 LLM 检查语病、清晰度和行文质量，审阅结果以"全文意见 / 段落意见 / 局部修改"三层形式绑定到原文位置，所有修改必须先预览、再由用户逐条确认后才会应用。

完整的产品定义、技术设计与实施计划见 [PLAN.md](./PLAN.md)。

## 技术栈

- Next.js (App Router) + TypeScript + React
- Tiptap 编辑器（Decoration 实现建议标记，不污染正文）
- Zod 作为运行时数据协议的唯一来源
- Dexie (IndexedDB) 本地持久化
- Vitest + Testing Library（单元测试），Playwright（端到端测试，阶段 6）

## 开发

```bash
npm install
npm run dev        # 开发服务器
npm run typecheck  # 类型检查
npm run test       # 单元测试
npm run lint       # ESLint
```

阶段 3 接入 LLM 前，先复制 `.env.example` 为 `.env.local` 并填入密钥。密钥只存在于服务端环境变量中。

## 实施进度

按 PLAN.md 第 14 节的阶段推进：

- [x] 阶段 0：项目初始化
- [ ] 阶段 1：编辑器与稳定段落
- [ ] 阶段 2：静态建议原型（假数据验证交互）
- [ ] 阶段 3：LLM 审阅
- [ ] 阶段 4：版本安全与批量修改
- [ ] 阶段 5：上下文聊天
- [ ] 阶段 6：产品化整理
