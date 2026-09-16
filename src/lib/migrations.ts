import type {
  ChatNode,
  Conversation,
  DocumentState,
  Project,
} from "./review-schema";
import { deriveProjectTitle } from "./chat-history";

/**
 * v2 → v3 迁移纯函数：把旧的「草稿文档 + 对话历史」组装成初始项目。
 *
 * 项目制下，左侧历史列表的单位从「对话」换成「文章」。旧库只有一份最近草稿
 * （documents 表单 id put 覆盖）和若干条对话（conversations 表），迁移时取
 * 最近一份草稿 + 最近一条对话，组装成一个 Project 导入 projects 表；
 * 没有草稿则空库起步（连对话也没有可挂的正文，一并丢弃）。
 *
 * 纯函数不碰 IndexedDB，upgrade 钩子（src/lib/storage/db.ts）负责取数与回写，
 * 这里只做组装，便于单测。
 */

/** 旧 documents 表的行（v1/v2 形态，与 DocumentState 一致） */
export type LegacyDocumentRow = DocumentState;
/** 旧 conversations 表的行（v2 形态） */
export type LegacyConversationRow = Conversation;

/**
 * 把旧数据组装成初始项目列表。正常情况下最多一条：
 * 取 updatedAt 最新的一份草稿 + 最新的一条对话。
 * 没有草稿返回空数组（空库起步）。
 */
export function migrateToProjects(
  documents: LegacyDocumentRow[],
  conversations: LegacyConversationRow[],
): Project[] {
  // 草稿只保留最近一份（旧实现就是单草稿覆盖），对话取最新一条
  const doc = latestBy(documents, (d) => d.updatedAt);
  if (!doc) return [];
  const conv = latestBy(conversations, (c) => c.updatedAt);

  const now = new Date().toISOString();
  const nodes: ChatNode[] = conv
    ? [
        {
          id: `node_${conv.id}`,
          anchor: { type: "document" },
          originalText: "",
          createdAt: conv.createdAt,
          turns: conv.turns,
        },
      ]
    : [];

  return [
    {
      id: `proj_${doc.id}`,
      title: doc.title || deriveProjectTitle(doc),
      doc,
      reviews: [],
      nodes,
      lastActivityAt: now,
    },
  ];
}

function latestBy<T>(list: T[], getTime: (item: T) => string): T | undefined {
  let best: T | undefined;
  for (const item of list) {
    if (!best || getTime(item) > getTime(best)) best = item;
  }
  return best;
}
