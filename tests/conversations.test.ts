import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAllConversations,
  deleteConversation,
  listConversations,
  saveConversation,
} from "@/lib/storage/conversations";
import { saveDocument, loadLatestDocument } from "@/lib/storage/documents";
import type { Conversation, DocumentState } from "@/lib/review-schema";

/**
 * Dexie / IndexedDB 存取（tests/setup.ts 里装了 fake-indexeddb）。
 *
 * 守护点：v2 新增 conversations 表后，documents 表必须仍然可读写。
 * 多层 version().stores() 在 Dexie 里是**合并**语义（删表要显式写 `表名: null`），
 * 但这条容易被误解成「每级都要列全」，一旦有人按误解去改 db.ts，这里会先报错。
 */

function makeConversation(id: string, updatedAt: string): Conversation {
  return {
    id,
    title: `对话 ${id}`,
    turns: [
      { role: "user", content: "问题" },
      { role: "assistant", content: "回答" },
    ],
    documentId: "doc_test",
    createdAt: updatedAt,
    updatedAt,
  };
}

const DOC: DocumentState = {
  id: "doc_test",
  title: "测试文档",
  blocks: [{ id: "p_1", type: "paragraph", text: "正文" }],
  revision: 1,
  checksum: "abc12345",
  updatedAt: "2026-09-15T10:00:00.000Z",
};

beforeEach(async () => {
  await clearAllConversations();
});

describe("对话历史持久化", () => {
  it("保存后能读回，且按更新时间新到旧", async () => {
    await saveConversation(makeConversation("c_old", "2026-09-15T09:00:00.000Z"));
    await saveConversation(makeConversation("c_new", "2026-09-15T11:00:00.000Z"));

    const list = await listConversations();
    expect(list.map((c) => c.id)).toEqual(["c_new", "c_old"]);
  });

  it("同一 id 覆盖而非新增轮次记录", async () => {
    const first = makeConversation("c_1", "2026-09-15T09:00:00.000Z");
    await saveConversation(first);
    const grown: Conversation = {
      ...first,
      turns: [...first.turns, { role: "assistant", content: "补充" }],
      updatedAt: "2026-09-15T12:00:00.000Z",
    };
    await saveConversation(grown);

    const list = await listConversations();
    expect(list).toHaveLength(1);
    expect(list[0].turns).toHaveLength(3);
  });

  it("删除只影响目标条目", async () => {
    await saveConversation(makeConversation("c_1", "2026-09-15T09:00:00.000Z"));
    await saveConversation(makeConversation("c_2", "2026-09-15T10:00:00.000Z"));

    await deleteConversation("c_1");
    const list = await listConversations();
    expect(list.map((c) => c.id)).toEqual(["c_2"]);
  });

  it("清空后列表为空", async () => {
    await saveConversation(makeConversation("c_1", "2026-09-15T09:00:00.000Z"));
    await clearAllConversations();
    expect(await listConversations()).toEqual([]);
  });

  it("写入时过 schema：缺字段的对话会被拒绝，不会落库", async () => {
    // 故意绕过类型，模拟旧数据/手改 IndexedDB 的损坏记录
    const broken = { id: "c_bad", title: "缺字段" } as unknown as Conversation;
    await expect(saveConversation(broken)).rejects.toThrow();
    expect(await listConversations()).toEqual([]);
  });

  it("升到 v2 后草稿表仍可用（新增表不能把原有表弄丢）", async () => {
    await saveDocument(DOC);
    const loaded = await loadLatestDocument();
    expect(loaded?.id).toBe("doc_test");
    expect(loaded?.blocks[0].text).toBe("正文");
  });
});
