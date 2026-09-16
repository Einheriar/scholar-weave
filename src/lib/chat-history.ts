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

/** 项目按最近活动（lastActivityAt）新到旧排序，不改动入参数组 */
export function sortProjects(list: Project[]): Project[] {
  return [...list].sort((a, b) =>
    a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0,
  );
}

/** 按 id 覆盖或插入一个项目，返回重新排好序的新列表（不就地修改入参） */
export function upsertProject(list: Project[], project: Project): Project[] {
  return sortProjects([
    project,
    ...list.filter((p) => p.id !== project.id),
  ]);
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
