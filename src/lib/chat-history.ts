import type { DocumentState, Project } from "./review-schema";

/**
 * 项目 / 对话历史的纯函数工具（PLAN 7 的延伸 + 项目制）。
 * 只做派生与排序，不碰存储（存储在 src/lib/storage/projects.ts）也不碰 React。
 */

export function newProjectId(): string {
  return `proj_${crypto.randomUUID()}`;
}

/**
 * 项目标题：取文档标题，为空则退而取正文首段截断。
 * 文档标题是用户在标题框里输入的；未填时给正文开头的片段，列表里能看出是哪篇。
 */
export function deriveProjectTitle(doc: DocumentState): string {
  const manual = doc.title.trim();
  if (manual) return manual;
  const first = doc.blocks[0]?.text.trim() ?? "";
  if (!first) return "未命名文章";
  return first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX)}…` : first;
}

/**
 * 列表顺序是**显式**的（`order` 升序，越小越靠前），不再是按时间派生——
 * 用户可手动拖动排序，只有「活动」才会把项目提到最前（见 moveProjectToTop）。
 *
 * 旧数据可能没有 `order`（Dexie v4 之前写入的），一律排到最后并按活动时间兜底，
 * 这样即便迁移没跑到，显示顺序也稳定、不会乱跳。
 */
function orderOf(p: Project): number {
  return p.order ?? Number.MAX_SAFE_INTEGER;
}

/** 按显式 order 升序，不改动入参数组；缺 order 的排末尾（内部按活动时间新到旧） */
export function sortProjects(list: Project[]): Project[] {
  return [...list].sort((a, b) => {
    const d = orderOf(a) - orderOf(b);
    if (d !== 0) return d;
    return a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0;
  });
}

/**
 * 按 id 覆盖或插入一个项目，**位置语义**：
 * - 已有 id：原地替换（保留它当前的 order，不动位置）；
 * - 新 id：插到最前。
 * 不按活动时间重排——「置顶」是独立动作，由 moveProjectToTop 显式做。
 */
export function upsertProject(list: Project[], project: Project): Project[] {
  const idx = list.findIndex((p) => p.id === project.id);
  if (idx === -1) {
    return [{ ...project, order: topOrder(list) }, ...list];
  }
  const next = [...list];
  next[idx] = { ...project, order: list[idx].order };
  return next;
}

/**
 * 下一批置顶要用的 order = 当前最小值 - 1（列表为空给 0）。
 *
 * 刻意**不重编号**其余项目：置顶发生在每次「活动」（编辑/回复）上，重编号会让每次
 * 保存都要写回全表；只改被移动项一行，写回也就一行。order 因此不保证连续，
 * 只在显式拖动排序（reorderProjects）时才压回 0..n-1。
 */
function topOrder(list: Project[]): number {
  if (list.length === 0) return 0;
  return Math.min(...list.map(orderOf)) - 1;
}

/** 把某个项目移到列表最前（「活动置顶」）；其余保持相对顺序。找不到则原样返回 */
export function moveProjectToTop(list: Project[], id: string): Project[] {
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) return list;
  // 只改这一项，且只在它本来就不在顶部时才动（省掉无谓的 order 变动与写回）
  if (list[0].id === id) return list;
  const next = [...list];
  const [target] = next.splice(idx, 1);
  next.unshift({ ...target, order: topOrder(list) });
  return next;
}

/**
 * 按给定 id 顺序密集重编号（显式拖动 / 键盘移动后调用），返回 order = 0..n-1 的新列表。
 * `orderedIds` 里没有的项目按原顺序追加到末尾，避免因状态不同步丢条目。
 */
export function reorderProjects(list: Project[], orderedIds: string[]): Project[] {
  const byId = new Map(list.map((p) => [p.id, p]));
  const next: Project[] = [];
  for (const id of orderedIds) {
    const p = byId.get(id);
    if (p) {
      next.push(p);
      byId.delete(id);
    }
  }
  for (const p of list) if (byId.has(p.id)) next.push(p);
  return next.map((p, i) => ({ ...p, order: i }));
}

/** 把 ids 里 index 处的元素移动到 to 位置并返回新数组（键盘/拖拽共用） */
export function moveId(ids: string[], index: number, to: number): string[] {
  if (to < 0 || to >= ids.length || index < 0 || index >= ids.length || to === index) {
    return ids;
  }
  const next = [...ids];
  const [it] = next.splice(index, 1);
  next.splice(to, 0, it);
  return next;
}

/**
 * 拖动触发阈值：被拖行与邻居的**边缘重叠**达到行高的这个比例，就算「越过」它。
 *
 * 为什么按边缘而不是「中心过半」：用中心判定时，被拖行要推进到邻居中线才换位，
 * 画面上两个框已经叠在一起、甚至越过去了，邻居还纹丝不动。用户明确要求
 * 「刚好盖住的时候就应该开始滑动」，所以取 **0** —— 边缘一接触即刻让位。
 *
 * 这里不会抖：判定用的是**拖动开始时**的几何快照（见 useHistoryDrag.geoRef），
 * 不读邻居被让位后的实时位置，所以同一个位移永远得出同一个落点，不存在反馈循环。
 */
export const DRAG_TRIGGER_RATIO = 0;

/**
 * 拖动中，被拖行最终应落在的下标（同时决定其余行怎么让位、以及松手落在哪）。
 *
 * 判定基于**边缘重叠**：被拖行的边进入上方/下方某个邻居的盒子、重叠达到阈值，
 * 就算越过了它。越过 k 个上方的行 → 下标减 k；越过下方的 → 加 k。
 * tops 与 dy 都在「列表坐标系」里（dy 已含自动滚动补偿），因此不受滚动影响。
 */
export function dragTargetIndex(
  tops: number[],
  h: number,
  from: number,
  dy: number,
  ratio: number = DRAG_TRIGGER_RATIO,
): number {
  const n = tops.length;
  if (from < 0 || from >= n || h <= 0) return from;
  const draggedTop = tops[from] + dy;
  const need = ratio * h;
  let above = 0;
  let below = 0;
  for (let j = 0; j < n; j++) {
    if (j === from) continue;
    // 用**严格大于**：零重叠（刚好贴上）不算越过，一有重叠就算。
    // 配合列表的行间距，效果就是「两个框刚好盖住时立刻开始让位」。
    if (j < from && tops[j] + h - draggedTop > need) above++;
    else if (j > from && draggedTop + h - tops[j] > need) below++;
  }
  return Math.max(0, Math.min(n - 1, from - above + below));
}

/**
 * 拖动中的每行位移（px）：被拖的那行跟着指针走，其余行按目标落点让开一行。
 *
 * 纯函数便于单测——拖拽的视觉手感依赖真实浏览器，但「谁该让位、让多远」是纯几何，
 * 抽出来就能在 vitest 里守住。约定：
 * - `to` 是最终落点下标（由 dragTargetIndex 给出），不是「插入位」；
 * - 被拖行（index === from）位移 = dragDy（跟手距离，松手时传回落距离）；
 * - 中间段行移动到相邻槽位，距离从 `tops` 的相邻差值取得（包含列表行间距）；
 * - 其余行不动。
 */
export function dragShifts(
  count: number,
  from: number,
  to: number,
  tops: number[],
  dragDy: number,
): number[] {
  const out = new Array<number>(count).fill(0);
  if (from < 0 || from >= count) return out;
  out[from] = dragDy;
  if (to === from || to < 0 || to >= count) return out;
  for (let i = 0; i < count; i++) {
    if (i === from) continue;
    if (from < to && i > from && i <= to) {
      out[i] = (tops[i - 1] ?? tops[i]) - (tops[i] ?? 0);
    } else if (from > to && i >= to && i < from) {
      out[i] = (tops[i + 1] ?? tops[i]) - (tops[i] ?? 0);
    }
  }
  return out;
}

/** 列表里标题的字符上限，超出截断加省略号 */
const TITLE_MAX = 24;

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * 列表里的相对时间：刚刚 / N 分钟前 / 今天 HH:MM / 昨天 HH:MM / M月D日 / Y年M月D日。
 * now 可注入，便于测试；本地时区渲染，调用点只在客户端挂载后执行（无水合差异）。
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  const diffMs = now.getTime() - t.getTime();
  if (diffMs < 60_000) return "刚刚";
  const hhmm = `${pad(t.getHours())}:${pad(t.getMinutes())}`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} 分钟前`;
  if (isSameDay(t, now)) return `今天 ${hhmm}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(t, yesterday)) return `昨天 ${hhmm}`;
  if (t.getFullYear() === now.getFullYear()) {
    return `${t.getMonth() + 1}月${t.getDate()}日`;
  }
  return `${t.getFullYear()}年${t.getMonth() + 1}月${t.getDate()}日`;
}
