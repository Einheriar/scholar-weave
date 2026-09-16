import Dexie, { type Table } from "dexie";
import type { Project } from "../review-schema";
import { migrateToProjects } from "../migrations";

/**
 * Dexie 实例的唯一持有者。项目制下本地只存一张 projects 表：
 * 一项 = 一篇文章的完整工作现场（正文 + 审阅建议 + 聊天节点）。
 * 读写放在同目录下的 projects.ts 里。
 */

export class SuperGrammarlyDB extends Dexie {
  projects!: Table<Project, string>;

  constructor() {
    super("super-grammarly");

    // v1：documents（v2 之前的历史版本，仅迁移期读取）
    this.version(1).stores({
      documents: "id, updatedAt",
    });
    // v2：新增 conversations（旧对话历史，仅迁移期读取）。
    // 实测（Dexie 4）：version().stores() 会与上一版的 schema **合并**，
    // 这里仍列出 documents 是为了这一行就能读出新版完整形状。
    this.version(2).stores({
      documents: "id, updatedAt",
      conversations: "id, updatedAt",
    });
    // v3：项目制。新增 projects 表（索引 id + doc.updatedAt，顶替原 documents.updatedAt
    // 让 loadLatestProject 走索引排序）；upgrade 把旧「草稿 + 对话」组装成初始项目导入，
    // 然后显式 documents:null / conversations:null 删旧表（合并语义下删表必须写 null，
    // 见 AGENTS.md 第 13 条）。
    this.version(3)
      .stores({
        documents: null,
        conversations: null,
        projects: "id, doc.updatedAt",
      })
      .upgrade(async (tx) => {
        const documents = (await tx.table("documents").toArray()) as Parameters<
          typeof migrateToProjects
        >[0];
        const conversations = (await tx.table("conversations").toArray()) as Parameters<
          typeof migrateToProjects
        >[1];
        const projects = migrateToProjects(documents, conversations);
        if (projects.length > 0) {
          await tx.table("projects").bulkPut(projects);
        }
      });
  }
}

let db: SuperGrammarlyDB | null = null;

export function getDB(): SuperGrammarlyDB {
  if (!db) db = new SuperGrammarlyDB();
  return db;
}
