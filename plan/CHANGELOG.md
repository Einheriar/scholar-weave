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

- `—`       feat: 正文纸张右上角新增当前会话撤销按钮，悬停／聚焦提示「撤销 / Ctrl+Z」，并随 Tiptap 历史实时切换禁用态；按文档 ID 重建编辑器，避免初始化产生伪历史或切换文章后串用撤销栈。单条建议接受／安全撤销不进入普通历史，避免正文与卡片状态脱节，ChangeSet 仍可作为一次正文操作撤销。
- `—`       fix: 撤销折角在无历史时仍以低饱和灰绿色展开显示；单条审阅建议接受后纳入右上角按钮与 `Ctrl+Z` 的统一撤销顺序，撤销时同步恢复正文和建议卡状态。
- `—`       feat: 聊天节点支持反向定位正文锚点——时间线节点身份竖条与头部当前上下文标签均可点击；范围锚恢复选区，其他锚复用高亮或落光标，并按 sticky 聊天框上方的可读区域定位滚动。失效锚点禁用入口且不猜测位置。
- `—`       style: 正文真实选区改用中性灰底并保留正文原色，避免与聊天 range 锚的琥珀虚线争夺语义；深色模式独立适配，Windows 高对比度模式继续使用系统选区色。
- `—`       style: 在正文选区的中性灰基底中轻掺 8% 主题绿，使其与产品配色建立弱联系，同时保持灰色主调并继续避开聊天节点的琥珀语义。
- `—`       fix: 区分侧栏建议产生的程序化文本选区与用户人工 range 选区；建议定位保持 review 聊天上下文，并让真实选区与建议高亮共用同一品牌绿填充，避免双层颜色叠加。用户重新划词时退出建议选中态并切换为 range 上下文。
- `—`       fix: 统一 Tooltip 在触发器点击时立即收起，避免设置按钮仍处于 hover／focus 时，“设置”提示通过 portal 残留在模态遮罩上方。
- `—`       feat: “测试连接”失败时由代表整套配置的名称框重播轻量横向 shake、显示暂态错误边框，并在下方淡入服务端错误信息；配置框与测试按钮严格对齐，3 秒后柔和恢复，重复失败可再次触发，减少动态效果模式下禁用位移。
- `—`       style: 连接失败 shake 改为 340ms 高频阻尼节奏，以更多短促往返和逐级收窄的位移增强紧张感，并使用 `translate3d` 与统一缓动减少转折顿挫。
- `—`       fix: 设置面板只在重新打开时同步外部 settings 到草稿，避免首次保存后的 props 回传立即清掉“已保存！”状态；连续保存会重新计算完整的 2 秒成功提示时间。
- `—`       fix: 审阅卡片和修改集预览的英文原文／改写由任意字符断行改为优先按单词边界换行，并为 flex 文本列补 `min-w-0`，避免单词末尾字母孤立到下一行。
- `—`       fix: 人工选择正文后聚焦聊天输入框时，用仅在编辑器失焦时显示的 Decoration 镜像原选区；聊天上下文与发送能力保持不变，重新聚焦正文时恢复为单层原生选区高亮，避免颜色叠加。
- `—`       fix: 聊天高度拖拽由仅调整消息列表的 `max-height` 改为直接调整实际高度，使短对话也能即时跟随把手伸缩；同时在指针取消时可靠结束拖拽，并增加真实鼠标拖拽回归测试。把手扩大纵向留白，保留与标题区之间的上分隔线、去掉下分隔线，兼顾层级与呼吸感。
- `—`       fix: 为待处理的审阅意见卡片补齐「忽略」操作；忽略后与接受一样收起为已处理三行态，并可通过「撤销」恢复为待处理后重新展开，不再只能继续询问或生成修改。
- `—`       feat: 上下文对话新增 `answer_with_review` 候选意见协议；带标记的 assistant 气泡可将讨论结论转为锚定当前聊天节点的 `opinion`，首次点击创建并留在对话，之后按钮变为“查看审阅意见”以定位卡片，刷新后保持关联且不会重复创建。按钮使用无阴影平面样式，保留浮入／悬浮／按压动效、主题色边框反馈与 reduced-motion 退化。
- `—`       polish: 点击“查看审阅意见”时，消息抽屉沿底部方向平滑收拢，内容仅轻微降淡并随轨迹下移；右侧卡片在收拢早期即定位，并用一次无阴影的品牌色边框扩散承接视觉重心。聊天输入框与外框保持在场，消除上下文切换时的闪断感。
- `2585c9b` fix: 自动项目标题由固定截取 24 个字符改为优先取英文前 12 个词，连续文本仍取前 24 个字符；
  改从第一个非空段落派生，并为异常长词设置 96 字符硬上限。标题仍在首次建档时写入文档标题，保持顶栏与历史列表联动，全程不调用 LLM。
- `241e106` fix: 代码审查后的可靠性修复——付费请求期间锁定文章现场并用请求世代号、`id/revision/checksum`
  阻止异步结果串写；审阅结果和处理状态纳入项目持久化；模型建议/修改 ID 改为服务端统一生成；
  思考档位正式传给 provider；聊天历史不再重复发送当前消息。
- `241e106` fix: 编辑器与交互边界修复——自然段内 `\n` 与 Tiptap `hardBreak` 双向保真，程序化替换按纯文本处理；
  单条 range/block 修改改为可跨刷新且不覆盖后续编辑的安全撤销；ChangeSet 在接受时按当前正文重新定位；
  载入样例清空旧聊天现场；修正 reduced-motion 下卡片内容消失、ChangeSet 退出动画无法收尾和拖动取消仍提交排序。
- `241e106` polish: 历史排序保留拖动中的 300ms 果冻让位，且推开/回原位统一保留同一过渡、让位距离纳入 4px 行间距；松手落位拆成 180ms 无过冲吸附；位置、缩放、
  阴影和提亮同步收回，动画结束后无过渡提交 DOM 顺序，消除落下拖沓与交接断层。
- `8f25596` polish: 窄屏历史抽屉的变形按钮保留「历史记录 → 新文章」逻辑；默认态改为极淡品牌底色和四周柔影，操作态与当前项目使用同一品牌配色，并用更明显的指针倾斜与跟随高光，补齐键盘焦点和 reduced-motion 退化。
- `aa344c8` polish: 为操作态增加虹彩细边、青绿／紫色外辉光与白色镜面反光。
- `—` polish: 固定虹彩边缘与彩色外辉光，不再让它们随指针变色；仅保留小范围、低透明度的中性反光跟随鼠标。
- `—` polish: 宽屏顶栏操作组改为相对正文栏居中，文档标题自适应填满左侧剩余空间并可在中窄屏优先压缩；宽屏移除重复的待处理计数，并在复制全文旁新增只重置当前现场、立即落库且不影响其他历史的「清空项目」。

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

## 项目制历史 + 锚点节点聊天（plan/discussion-document-vs-conversation-history.md）

- `82abecd` feat: 数据层切项目制 + 左栏项目列表（阶段 1+2）——`Project`/`ChatNode` schema、
  `src/lib/migrations.ts` 旧 documents+conversations → 初始 Project（迁移后删旧表，Dexie v3 仅 projects）、
  `src/lib/chat-nodes.ts` 节点身份判定、`src/lib/storage/projects.ts`、ChatHistory 改项目列表（data-project-id /
  「新文章」/「删除文章：」）；配套 `tests/projects.test.ts`（含迁移纯函数）、`tests/chat-nodes.test.ts`
- `cafac91` feat: 聊天区节点化（阶段 3）——发送那一刻按锚点身份找/建节点（规则 7/8/10）、
  规则 11 无选区禁止提问、规则 24 节点边界即上下文边界（history 仅本节点、openReviews 仅锚点段落）、
  ContextChat 头部上下文标签 + 新文章按钮 + stale 存档横幅
- `2500bf5` feat: 节点时间线弹层（阶段 4）——`NodeTimeline` 组件（brand 圆点 + 轮次轨道 + 行内直接删除，
  规则 13）；`handleJumpToTurn` 跳某轮
- `35d93bc` feat: 聊天区浮动 + 最小化（阶段 5）——`sticky bottom-4 z-40` dock（规则 21）、最小化成窄条（规则 22）
- `—`       feat: 正文锚点标记（阶段 6）——`ChatAnchorDecorationExtension`（range 虚线下划线 / block 左侧竖条，
  点击标记切节点对话）、`globals.css` 加 `.chat-anchor`/`.chat-anchor-block`（品牌绿，双主题）；
  `tests/chat-anchor-decoration.test.ts`
- `—`       fix: 聊天节点丢失/回复不落库——React 批处理下 `setNodes(updater)` 的副作用与返回值不可靠，
  改为基于 `latestRef` 先算好数组再 setState + `persistProjectNow(repliedNodes)` 立即落库；
  新增陷阱 21/22 记入 AGENTS.md
- `—`       test: E2E `selectTextInEditor` 重写——createRange+TreeWalker 取词坐标、滚出浮动聊天区遮挡、
  多词短语双击词尾再 Shift+点词首；review-chat/chat-history 用例补选区步骤；全套 23 个 Playwright + 141 个 Vitest 通过
- `—`       docs: AGENTS.md「左侧对话历史」改写为「项目制」+ 聊天节点/锚点约定 + 陷阱 21/22 + 关键文件地图更新
- `—`       feat: 节点时间线改抽屉 + 聊天区拖拽调高 + 删头部新文章按钮 + 上下文焦点回落——
  ① NodeTimeline 从居中弹窗改为从聊天区顶部向上滑出的抽屉（`absolute bottom-full`、`animate-timeline-rise`，
  标题行 sticky，点面板外收起）；② 聊天区头部与消息区之间加拖拽把手（`调整聊天区高度`，
  范围 180–720px，实时持久化 `supergrammarly-chat-height` localStorage）；③ 删除聊天区头部
  「新文章」按钮（新建文章统一走左侧栏）；④ 修复焦点丢失：`chatContext` 回退链增加
  「正在查看的节点（activeNode 锚点）」一级，选区收起后不再掉回「当前上下文：全文」；
  端点数=用户提问数核对无误（1 问 = 1 端点居中）
- `—`       feat: 节点时间线美化 + 琥珀色 + 上下文联动（用户反馈修订第 2 轮）——
  ① 抽屉与聊天区连成一体（聊天区顶部圆角让位、共享边框、抽屉 `max-h-[42vh]` 内部滚动）；
  「关闭」文字改 × 图标、历史按钮改 toggle（`aria-expanded`、开态琥珀底）；
  ② hover 端点即时浮出自定义摘要 tooltip（锚点摘要 + 提问截断），**钉在抽屉顶部**，
  绝对定位悬浮层（脱离文档流 + `pointer-events-none`）——修掉「摘要放进流内撑开行 → 端点位移 → hover 循环闪烁」的 bug；
  ③ 行首「节点身份」从圆点改竖条（不再被误认成端点）；
  ④ 节点系统整体换琥珀色（`--node-*` 令牌，深浅双套），覆盖时间线/正文锚点标记/头部指示点/历史按钮开态，
  与审阅红/绿、品牌绿三层错开；hover 端点 = 放大 + 琥珀光晕（`box-shadow` 双层）；
  ⑤ 上下文联动：点侧栏/正文另一条建议、或划出新选区时，聊天视图同步切到该上下文对应节点
  （`page.tsx` 新增 effect，只依赖 `selection`/`selectedId`），头部标签与消息列表永远一致。
  全套 141 Vitest + 23 Playwright 通过

## 窄屏历史抽屉（用户反馈修订第 4–5 轮）

- `a14480b` feat: 窄屏历史抽屉标题化 + 汉堡/叉叉同位切换 + 冷却防抖——
  ① 「历史记录」升级为抽屉标题（更大字号），去掉标题下分割线改呼吸间距；
  ② 顶栏汉堡与叉叉**同位置**原地切换（双 SVG 叠格 `data-state` + `grid-area: 1/1`，
  见 globals.css `.t-icon-swap`），按钮放大到 40×40，双击不移动鼠标即可开关；
  ③ 标题行 `pl-14` 让出按钮槽位，「叉叉 + 标题」逐像素连成一行；
  ④ 冷却 500ms（动画 250ms + 250ms）在 JS 层做，挡住双击与关闭动画中途重开
- `c384ffc` feat: 抽屉标题 hover 交叉淡入 + 宽度 +50% + 点新文章保持开启——
  ① 「历史记录」做成按钮样式靠右，hover 时与「新文章」按钮 250ms 交叉淡入
  （transitions.dev skeleton-reveal 思路）；两字重 500 / 18px，字间距调到同宽 96.2px；
  ② 交叉淡入状态改由内联 style + React 事件驱动（Turbopack 的 Lightning CSS 会合并
  相同声明的相邻规则并丢掉整条，CSS 方案反复失效）；
  ③ 抽屉 `w-60` → `w-90`（窄屏一屏只干一件事，抽屉是主要工作区）；
  ④ `handleNewProject` 加 `keepHistoryOpen` 选项，点「新文章」不再收起抽屉
- `e1cd08a` feat: 新文章凸起三件套 + 新建条目 toast-rise 出现动画——
  ① 按钮「可按下」用扁平凸起三件套表达：hover 背景抬亮到纸面 + `translateY(-1px)` + 软投影，
  active 位移/投影收回 + `scale-[0.98]`（深色下黑投影弱，由位移/抬亮兜底）；
  ② 新建项目条目出现动画（transitions.dev Toast 思路 + 占位生长）：外层 `li`
  `grid-template-rows: 0fr → 1fr` 长高度（下面的项目被连续顶下去），内层内容从格底
  rise + fade + 轻缩放 + 交叉模糊（350ms open 时钟）；
  ③ 只播一次：`pendingNewRef` 等防抖建档后换具体 id 钉住该条目，动画播完回调清
  `justCreatedId`，重渲染/筛选/切回不重演
- `—`       fix: 「新文章」三字不居中——`tracking-[0.3em]` 在末字后也追加 5.4px 字距且
  布局算进宽度，`justify-center` 居中「三字 + 末尾空白」导致墨迹左偏半个字距；
  包一层 `-mr-[0.3em]` 负边距抵消尾随留白（实测墨迹中心与按钮中心差 0.005px）；
  同时修正自测方法（`Range` 量的是 advance 盒、含末尾留白，量不出偏），陷阱 23 记入 AGENTS.md
- `—`       fix: **历史项目列表整列消失**（用户报告「找不到之前的聊天项目」）——
  `e1cd08a` 把出现动画的起始态 `display:grid; grid-template-rows:0fr` 写进了
  `.t-toast-rise` 常驻规则并无条件挂到每条 `li`，导致没挂动画态的条目行高全为 0
  （数据都在，`li.getBoundingClientRect().height === 0`）。改为：起始态只写进 `@keyframes`
  （`animation: toast-rise-rows ... both`），且 rising 结构只挂在会动的那一条上；陷阱 24 记入 AGENTS.md
- `—`       fix: 聊天消息含 markdown 列表时报 React「Each child in a list should have a
  unique key prop」（左下角 dev 覆盖层 1 Issue）——`mini-markdown.tsx` 的 `renderList`
  返回的块级 `<div>` 漏了 `key`（同批 `p`/`h`/`hr` 都有），补 `key={keyPrefix}`；
  新增两条回归用例（混排/嵌套列表断言无 key 警告，验证过移除 key 即失败）
- `—`       fix: 点「新文章」后要等约 1s 新项目才出现 + 旧项目无端「刷新」跳顶——
  ① 建档（`newProjectId()` 分配 id + 插入列表 + `setJustCreatedId`）从 500ms 防抖落库路径
  移到点击那一帧同步做，出现动画与点击直接因果相连（实测点击后 18ms 新行即出现并从 0 长到
  55px）；`latestRef` 同步推进到新项目，避免随后的落库把旧文章内容写进新 id；
  ② 切换/新建时落库旧项目改用 `latestRef`（最新现场，含防抖窗口内刚敲的字，原先用
  `activeProjRef` 快照会丢掉这不到 500ms 的编辑）且**不再刷新 `lastActivityAt`**——
  「离开」不是活动，原先刷新会让该条目跳到列表顶部（实测旧项目时间戳保持冻结不再跳动）。
  实测（含防抖窗口内编辑后立刻新建、刷新后核对）数据零丢失

## 历史列表手动排序（拖动 + 键盘）

- `—`       feat: 项目列表支持手动拖动排序（活动置顶优先）——
  ① 顺序从「按时间派生」改为**显式 `order` 字段**（Zod `.optional()` 防 safeParse 丢旧数据）；
  Dexie 升 **v4** 并回填既有项目的 order（按升级前显示顺序，观感不变）；
  ② 语义：**一次活动（编辑正文/改标题/审阅/聊天）把该项目移到最前**，**点开查看不算活动**；
  手动拖动/键盘移动直接改写顺序。置顶只改一行（order = 最小值 − 1，不重编号全表），
  拖动排序才密集压回 `0..n-1`；
  ③ `chat-history.ts` 拆分语义：`upsertProject` 改为「原地替换、不动 order」，
  新增 `moveProjectToTop` / `reorderProjects` / `moveId`；
  ④ 交互用 **Pointer Events**（不引依赖）：独立拖拽把手（整行是「点开」按钮、内嵌删除按钮，
  拖动挂整行会打架）+ `touch-action:none`，触屏可用；边缘自动滚动；
  键盘 `↑/↓` 移动 + `aria-live` 播报（纯拖拽对键盘/读屏不可用）；
  ⑤ 顺带修既有 bug：**改标题不落库**（`onChange` 只 `setDoc`，没置 saving，
  改完刷新即丢、且不算活动）——补 `setSaveState("saving")`；
  ⑥ 测试：`chat-history` 21 例（含「缺 order 排末尾」「置顶保持相对顺序」「moveId 边界」）、
  `projects` 13 例（order 读回、批量写回、缺字段不丢行），并验证过往用例能抓回归。
  全套 153 Vitest 通过；浏览器实测拖动换位/落库/刷新保持/键盘排序/点开不改序/编辑置顶
- `—`       feat: 拖动排序换成「浮起跟手 + 其余项滑开」的手感（替换上一版的插入指示线）——
  ① 被拖条目挂 `.t-drag-lift`：独立 `scale: 1.03`（**不写进 transform**，transform 已被 JS
  占用做跟手位移，两者是独立属性可自行合成）+ 投影 + 背景提亮 + `z-index:30`；
  ② 其余条目按插入位让开一行高（`dragShifts`），靠 `.t-drag-shift` 的 CSS transition
  平滑滑开——「哗哗哗滑过去」的来源；拖动期间**不改 DOM 顺序**，只改 transform，
  避免行在指针下跳位与每帧 React 重排；
  ③ 松手先播回落（过渡到目标槽位）再提交顺序，视觉与数据不错位；拖动中禁选中文字；
  ④ 让位几何抽成 `dragShifts` 纯函数（含「与 moveId 落点一致」的一致性检查），
  新增 `tests/chat-history-drag.test.tsx` 12 例守住接线（jsdom mock 几何 + 指针捕获）；
  ⑤ 用 Playwright（系统 Chrome）真渲染实测：跟手位移逐步递增、其余行 ±57px 让位、
  浮起行 z=30 + shadow、松手回落、落库顺序正确；深色模式与 reduced-motion 均验证。
  全套 172 Vitest 通过
- `—`       fix: 拖动让位的**触发时机**与**手感**（两处都是用户反馈）——
  ① 触发时机：原按「被拖行推进到邻居**中心**」判定，于是两个框已重叠、甚至越过了还不让位
  （用户：「滑到跟底下的平齐、甚至越过底下，它都还没开始滑动…刚好盖住的时候就应该开始滑动」）。
  改为**边缘重叠即触发**（`dragTargetIndex`，阈值 `DRAG_TRIGGER_RATIO = 0`，判定用严格大于
  以免零重叠误触发）。实测行高 57px + 间距 4px 时，下移 **5px** 就让位（旧行为约需 29px）。
  落点判定抽成纯函数，渲染期与该函数共用同一份几何快照与位移，保证「看到的落点 = 提交的落点」；
  ② 手感：过渡换 `cubic-bezier(0.34,0,0.64,1.4)` + 300ms —— x1=0.34 给出慢起加速段、
  y2=1.4>1 让末端**过冲 5%** 再回弹（实测 57px 行程冲过 3px 到 60px，再落回 56.5px），
  即用户要的「先加速后减速 + 果冻」。原 ease-out（0.22,1,0.36,1）前 1/3 时间走完八成行程，
  读起来像瞬移。回落定时器抽成 `SETTLE_MS`（330ms）与 CSS 时长配套；
  ③ 几何快照同时存 ref 与 state：**事件回调读 ref**（state 更新要等重渲染，同一事件链里读会拿旧值
  ——踩过：纯 state 时松手落点算错、不提交），**渲染期读 state**（ref 不允许在渲染期读，react-hooks/refs）。
  新增 `dragTargetIndex` 6 例几何用例，全套 **180** Vitest 通过
