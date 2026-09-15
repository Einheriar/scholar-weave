import { getDB } from "./db";
import {
  DocumentStateSchema,
  type DocumentState,
} from "../review-schema";

/**
 * 草稿文档的本地持久化（PLAN 5.1）。
 * 写入前用 schema 校验，读出时也校验：损坏数据直接丢弃，不带进编辑器。
 * 只保留最近一份草稿（同一主键上 put 覆盖），不做版本历史。
 */

export async function saveDocument(doc: DocumentState): Promise<void> {
  const parsed = DocumentStateSchema.parse(doc);
  await getDB().documents.put(parsed);
}

export async function loadDocument(
  id: string,
): Promise<DocumentState | undefined> {
  const row = await getDB().documents.get(id);
  if (!row) return undefined;
  const result = DocumentStateSchema.safeParse(row);
  return result.success ? result.data : undefined;
}

export async function loadLatestDocument(): Promise<
  DocumentState | undefined
> {
  const rows = await getDB()
    .documents.orderBy("updatedAt")
    .reverse()
    .limit(1)
    .toArray();
  const row = rows[0];
  if (!row) return undefined;
  const result = DocumentStateSchema.safeParse(row);
  return result.success ? result.data : undefined;
}

export async function deleteDocument(id: string): Promise<void> {
  await getDB().documents.delete(id);
}

/** 清空所有本地保存的文档（阶段 6：清空数据） */
export async function clearAllDocuments(): Promise<void> {
  await getDB().documents.clear();
}
