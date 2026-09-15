# 阶段 9 交接：思考档位四档化 + 模型配置预设（工作进行中）

> 写于 2026-09-15。**接手前必读**：本工作未提交，直接在工作区里继续。

## 当前状态

工作区有 5 个未提交文件，**代码已完成且静态验证全绿，但缺浏览器实测和 E2E 复跑**：

```
 M src/lib/settings.ts              # 重写：四档档位 + 预设结构 + 旧数据迁移
 M src/lib/llm/openai-provider.ts   # off 档透传为 enable_thinking=false
 M src/lib/llm/provider.ts          # 注释更新（无行为变化）
 M src/components/SettingsPanel.tsx # 模型 Tab：预设管理 UI + 新档位下拉
?? tests/settings.test.ts           # 新增 11 个用例（迁移/档位映射/请求体）
```

已验证：typecheck ✓、lint 0 problems、Vitest 76/76 ✓。
**未验证：`npm run test:e2e`、浏览器实际点一遍设置面板、生产 build、commit。**

## 需求背景（用户的原话转述）

1. **思考档位加「默认」选项**：不填、不传参、交给模型决定。原 7 档（minimal/low/medium/high/xhigh/max/ultra）太多，**砍成 4 档 + off**：
   - `auto` 默认（不传参）/ `off` 不思考 / `low` / `high` / `max`
   - low/high/max 是用户另一个 agent 调研得出的"行业最大公约数"（与 Kimi K3、DeepSeek 原生档位对齐）
2. **模型配置做成可命名预设**：用户可能同一提供商有多个 Key，切换配置不能互相覆盖。旧痛点：只有一份扁平配置，换提供商再切回来 Key 就丢了。

## 已落地的设计决策（不要推翻）

### 数据结构（src/lib/settings.ts）

```ts
type ReasoningEffort = "auto" | "off" | "low" | "high" | "max";

type LLMPreset = { id, name, apiKey, baseURL, model, reasoningEffort };
type UserSettings = {
  llm: { activeId: string; presets: LLMPreset[] };
  review: ReviewPreferences;  // 不变
};
```

- localStorage key 不变（`supergrammarly-settings`），**内部格式变了，靠 `migrateLlm()` 自动迁移**：
  - 读到旧扁平格式 `{ apiKey, baseURL, model, reasoningEffort }` → 包成单条预设，旧 7 档值全部落到 `auto`
  - `activeId` 非法 → 兜底第一条预设
  - 损坏 JSON → DEFAULT_SETTINGS
- `getActivePreset()` 保证永不返回 undefined；`createPreset()` 生成新预设（crypto.randomUUID，兜底时间戳）
- API 请求体协议不变：`settingsToRequestBody()` 仍发扁平 `llmConfig { apiKey, baseURL?, model?, reasoningEffort }`，Zod schema（review-llm-schema.ts）没动

### off 档的请求行为（src/lib/llm/openai-provider.ts）

- `auto` → 不传任何 thinking 参数
- `off` → 传 `enable_thinking: false`（DeepSeek 风格端点的软开关）
- `low/high/max` → 传 `reasoning_effort: <值>` 原样透传
- **故意不做按模型能力映射**（用户调研报告建议过 clamp 路由）：端点不支持就直接 400 报错给用户，比静默降级好。这是有意的简化，将来要做映射表再加。

`resolveThinkingParam()` 辅助函数已写好并测了，但 provider 里目前是内联 if-else，没用它（等价逻辑）。接手 agent 可选择统一过去或删除它，别留两处不一致的实现。

### UI（SettingsPanel 模型 Tab）

顶部新增一个 `bg-surface-muted/50` 的圆角容器：
- 「当前配置」Select（列出所有预设名字）+ `+ 新建`（secondary）+ `删除`（danger，只剩 1 条时 disabled）
- 「配置名称」input（改当前预设名字）
- 下面 API Key / Base URL / 模型 / 思考档位都操作 active 预设
- 默认预设：`默认配置` / DeepSeek 端点 / deepseek-chat / auto

**注意**：删除预设和新建预设是草稿态操作，点「取消」不生效、点「保存」才落盘，这点与其他字段一致。

## 接手后要做的事（按顺序）

1. `git diff` 看全部改动，对照本文件确认理解一致
2. `npm run test:e2e` —— 预期全过（设置面板相关 E2E 只有「载入样例」走数据 Tab，模型 Tab 结构变化不影响它），如果挂了就修
3. **浏览器实测**（dev server 已在 http://localhost:3000 跑着，PID 6480）：
   - 打开设置 → 模型 Tab：预设容器渲染正常、新建/删除/改名/切换都工作
   - 档位下拉是 5 项（默认/不思考/Low/High/Max）
   - **迁移实测**：在旧 commit（HEAD）的页面上存一份配置（填个 Key 保存），切回工作区代码刷新，确认 Key 还在、档位变「默认」
   - 深浅色模式各看一眼
4. `npm run build` 确认生产构建过
5. commit，建议信息：`feat: 思考档位四档化（auto/off/low/high/max）+ 模型配置预设`（5 个文件一起提）
6. 更新本 HANDOFF.md 的主文件部分（测试数 65 → 76 等，见下）

## 主 HANDOFF.md 需要同步更新的点

本文件是独立交接文档，但项目主 HANDOFF.md（仓库根目录，阶段 8 结尾）有几处已过时：

- 「65 个 Vitest 用例」→ 76 个（新增 tests/settings.test.ts 11 个）
- 「用户配置支持」一节提到的思考档位描述（minimal/low/medium/high/xhigh/max/ultra）→ 改为 auto/off/low/high/max
- 如果接手 agent 验证无误并 commit 后，可以把本文件的「当前状态」一节改为「已完成」并记录 commit hash

## 没做的需求（用户问过，但明确不属于本次）

- **代理问题**：用户问 Zero Omega 这类代理是否自动接管。答案：不需要做任何事——LLM 请求由 Next.js 服务端 fetch 发出，不经过浏览器；浏览器代理插件只影响用户访问页面本身。服务端要走代理得设 `HTTPS_PROXY` 环境变量（Node 原生 fetch 不自动读，需要 undici 的 EnvHttpProxyAgent 之类）。用户听后没要求实现，搁置。
- **按模型能力的档位 clamp 映射表**：见上「off 档的请求行为」，有意不做。

## 质量基线（接手时确认）

```
npm run typecheck   # 0 error
npm run lint        # 0 problems
npm run test        # 76 passed（11 文件）
npm run test:e2e    # 应 15 passed（接手 agent 需复跑确认）
npm run build       # 接手 agent 需跑一次
```

## 安全约束（沿袭，必须遵守）

- API Key 只允许出现在：服务端 env（.env.local）或用户浏览器 localStorage（明文，仅限本地使用，公开部署前必须解决）
- 密钥绝不进前端 bundle 代码、不进日志、不进 git
- 文档内容在 prompt 里作为不可信数据包裹（防注入）
- LLM 不直接改正文，必须经 ChangeSet 预览 + 用户确认
- 不信 LLM 返回的字符坐标，永远走 blockId + 原文 + 前后缀锚定，失败标记 stale
