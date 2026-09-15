import Dexie, { type Table } from "dexie";
import type { Conversation, DocumentState } from "../review-schema";

/**
 * Dexie 实例的唯一持有者（PLAN 5.1：本地保存当前草稿、设置和最近一次审阅结果）。
 * 文档与对话历史共用同一个 IndexedDB 库，各自的读写放在同目录下的
 * documents.ts / conversations.ts 里。
 */

export class SuperGrammarlyDB extends Dexie {
  documents!: Table<DocumentState, string>;
  conversations!: Table<Conversation, string>;

  constructor() {
    super("super-grammarly");
    this.version(1).stores({
      // 只索引主键和查询字段，blocks 正文不入索引
      documents: "id, updatedAt",
    });
    // v2：新增对话历史表。
    // 实测（Dexie 4）：version().stores() 会与上一版的 schema **合并**，这里只写
    // 新增的 conversations 也照样保留 documents；要删表必须显式写 `表名: null`。
    // 仍然把两张表都列出来，是为了这一行就能读出新版完整形状。
    this.version(2).stores({
      documents: "id, updatedAt",
      conversations: "id, updatedAt",
    });
  }
}

let db: SuperGrammarlyDB | null = null;

export function getDB(): SuperGrammarlyDB {
  if (!db) db = new SuperGrammarlyDB();
  return db;
}
