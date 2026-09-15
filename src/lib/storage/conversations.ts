import { getDB } from "./db";
import { ConversationSchema, type Conversation } from "../review-schema";

/**
 * 对话历史的本地持久化（左侧历史记录列表的数据源）。
 * 和文档一样：写入前 schema 校验，读出时校验、损坏即丢弃。
 *
 * 注意：列表会把**全部对话连同轮次**读进内存（Dexie 没有字段投影）。
 * 本地单人使用、条数有限，够用；若以后历史很长，再加一张只存
 * id/title/updatedAt/turnCount 的摘要表，列表读摘要、切换时再按 id 取全文。
 */

export async function saveConversation(
  conversation: Conversation,
): Promise<void> {
  const parsed = ConversationSchema.parse(conversation);
  await getDB().conversations.put(parsed);
}

/** 全部对话，新的在前（updatedAt 降序由索引直接给出） */
export async function listConversations(): Promise<Conversation[]> {
  const rows = await getDB()
    .conversations.orderBy("updatedAt")
    .reverse()
    .toArray();
  return rows.flatMap((row) => {
    const result = ConversationSchema.safeParse(row);
    return result.success ? [result.data] : [];
  });
}

export async function deleteConversation(id: string): Promise<void> {
  await getDB().conversations.delete(id);
}

/** 清空全部对话历史（与 clearAllDocuments 一起用于「清空数据」） */
export async function clearAllConversations(): Promise<void> {
  await getDB().conversations.clear();
}
