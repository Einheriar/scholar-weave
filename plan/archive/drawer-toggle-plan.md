# 窄屏历史抽屉：标题化 + 汉堡/叉叉同位切换（2026-09-16）

反馈驱动的小改动，全部只影响**窄屏抽屉**（`xl` 1280px 以下）的观感与开关交互；宽屏常驻左栏一个字不动。

## 已确认的决策

1. 「历史记录」升级为抽屉**标题**：`text-lg font-semibold text-foreground`，独立一行，与顶栏汉堡按钮视觉同行（按钮放大到 40×40 后正好）。
2. **删除标题下的分割线**（原 `border-b`），只留呼吸间距。
3. **汉堡/叉叉同位切换**（用户提供的 transitions.dev Icon swap 思路）：
   - 汉堡按钮留在顶栏原位、只放大到 40×40；
   - 打开时同一个 DOM 节点内部叠两个 SVG（汉堡 + 叉叉），CSS transition 切透明度/模糊/缩放；
   - 按钮 z-index 提升到 z-100（抽屉遮罩 z-90 会盖住顶栏，不提升叉叉点不到）；
   - 抽屉标题行左侧让出按钮宽度的空位，标题从空位右侧开始 → 「叉叉 + 标题」逐像素连成一行。
4. **新文章按钮**挪到标题行下一行，整行通宽、secondary 样式。
5. **冷却期**：toggle 被点击后 750ms 内（drawer 动画 250ms + 500ms）忽略同位置再次点击，自然解决"关闭动画中途又点开"的边界。
6. **删除抽屉底部「关闭」按钮**（关闭路径已足够：叉叉 / 点遮罩 / Escape）。
7. **prefers-reduced-motion**：transition 直接禁用（CSS 层），冷却期只剩 500ms。
8. 宽屏（xl 及以上）常驻左栏完全不动。

## 改动文件

- `src/components/chat/ChatHistory.tsx`
  - `HistoryList` 拆形态渲染：`variant="sidebar" | "drawer"`，抽屉形态用新标题行 + 通宽新文章按钮、删分割线；宽屏走原 12px 小标题。
  - 抽屉容器左侧 padding 让出按钮空位、顶部 padding 对齐按钮中线（pt 值实测写死，同 AGENTS.md 左栏 `100vh-8rem` 的约定级别）。
  - 删底部「关闭」按钮。
  - `ChatHistoryToggle`：h-9 w-9 → h-10 w-10；双 SVG 叠格 + `data-state` 切换；加 750ms 冷却；z-index z-100。
- `src/app/globals.css`
  - 加 `.t-icon-swap` 及 `--drawer-icon-swap-*` 变量（沿用 transitions.dev 思路，变量改名）。
  - 登记进 `prefers-reduced-motion` 覆盖名单。

## 验证

- `npm run typecheck` / `lint` / `test` 全绿。
- 浏览器实测：抽屉打开/关闭动画、叉叉与汉堡的切换、冷却期（快速双击不抖动）、遮罩/Escape 关闭、宽屏左栏不回归。
