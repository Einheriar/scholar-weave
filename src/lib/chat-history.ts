import type { ChatTurn, Conversation } from "./review-schema";

/**
 * 对话历史的纯函数工具（PLAN 7 的延伸）。
 * 只做派生与排序，不碰存储（存储在 src/lib/storage/conversations.ts）也不碰 React。
 */

export function newConversationId(): string {
  return `conv_${crypto.randomUUID()}`;
}

/** 列表里标题的字符上限，超出截断加省略号 */
const TITLE_MAX = 24;

/** 用首条用户消息当标题（ChatGPT 式），没有用户消息时给个占位 */
export function deriveConversationTitle(turns: ChatTurn[]): string {
  const first = turns.find((t) => t.role === "user");
  // 消息里可能有换行/连续空白，压成单行再截断，避免标题把列表撑高
  const text = (first?.content ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "新对话";
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX)}…` : text;
}

/** 新到旧：updatedAt 降序（ISO 字符串按字典序比较即时间序） */
export function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) =>
    a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
  );
}

/** 按 id 覆盖或插入一条，返回重新排好序的新列表（不就地修改入参） */
export function upsertConversation(
  list: Conversation[],
  conversation: Conversation,
): Conversation[] {
  return sortConversations([
    conversation,
    ...list.filter((c) => c.id !== conversation.id),
  ]);
}

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
