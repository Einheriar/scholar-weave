import Dexie, { type Table } from "dexie";
import {
  DocumentStateSchema,
  type DocumentState,
} from "../review-schema";

/**
 * IndexedDB 本地持久化（PLAN 5.1：本地保存当前草稿、设置和最近一次审阅结果）。
 * 阶段 1 先实现草稿文档的存取；审阅结果与设置的表结构预留到后续阶段。
 */

class SuperGrammarlyDB extends Dexie {
  documents!: Table<DocumentState, string>;

  constructor() {
    super("super-grammarly");
    this.version(1).stores({
      // 只索引主键和查询字段，blocks 正文不入索引
      documents: "id, updatedAt",
    });
  }
}

let db: SuperGrammarlyDB | null = null;

function getDB(): SuperGrammarlyDB {
  if (!db) db = new SuperGrammarlyDB();
  return db;
}

export async function saveDocument(doc: DocumentState): Promise<void> {
  // 写入前用 schema 校验，避免把损坏的状态持久化
  const parsed = DocumentStateSchema.parse(doc);
  await getDB().documents.put(parsed);
}

export async function loadDocument(
  id: string,
): Promise<DocumentState | undefined> {
  const row = await getDB().documents.get(id);
  if (!row) return undefined;
  // 读出时校验，损坏数据直接丢弃而不是带进编辑器
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
