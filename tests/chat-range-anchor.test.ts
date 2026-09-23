import { describe, expect, it } from "vitest";
import {
  createChatRangeLocator,
  locateChatNodeRange,
  selectionNeedsFullDocument,
} from "@/lib/chat-range-anchor";
import { createDocument, updateBlockText } from "@/lib/revisions";
import { ChatNodeSchema, type ChatNode, type DocumentState } from "@/lib/review-schema";

function rangeNode(
  doc: DocumentState,
  selectedText: string,
  start: number,
): ChatNode {
  const block = doc.blocks[0];
  return {
    id: "node_range",
    anchor: { type: "range", blockId: block.id, selectedText },
    rangeLocator:
      createChatRangeLocator(
        block.text,
        start,
        start + selectedText.length,
      ) ?? undefined,
    originalText: selectedText,
    createdAt: "2026-09-18T00:00:00.000Z",
    turns: [],
  };
}

describe("聊天 range 节点混合锚定", () => {
  function multiNode(doc: DocumentState, start = 0, end?: number): ChatNode {
    const blocks = doc.blocks.slice(0, 3);
    const text = blocks.map((block) => block.text).join(" ");
    const finish = end ?? text.length;
    const selectedText = text.slice(start, finish);
    return ChatNodeSchema.parse({
      ...rangeNode(doc, selectedText, start),
      rangeLocator: {
        ...createChatRangeLocator(text, start, finish),
        blockIds: blocks.map((block) => block.id),
      },
    });
  }

  it("跨三段选区刷新后仍逐段定位，并自动附带全文", () => {
    const doc = createDocument("t", ["First paragraph.", "Second paragraph.", "Last paragraph.", "Outside."]);
    const node = multiNode(doc, 6, 42);
    const restored = ChatNodeSchema.parse(JSON.parse(JSON.stringify(node)));
    const hit = locateChatNodeRange(doc, restored);
    expect(hit).toMatchObject({ ok: true, segments: [
      { blockId: doc.blocks[0].id, start: 6, end: 16 },
      { blockId: doc.blocks[1].id, start: 0, end: 17 },
      { blockId: doc.blocks[2].id, start: 0, end: 7 },
    ] });
    expect(selectionNeedsFullDocument(doc, node.anchor.blockId, node.anchor.selectedText, node.rangeLocator)).toBe(true);
    expect(selectionNeedsFullDocument(doc, doc.blocks[0].id, "First")).toBe(false);
    expect(selectionNeedsFullDocument(doc, doc.blocks[0].id, doc.blocks[0].text)).toBe(true);
  });

  it("跨段选区外编辑可重定位，但所选文本修改、删段、插段及重排均失效", () => {
    const doc = createDocument("t", ["before target", "middle", "last after"]);
    const node = multiNode(doc, 7, 25);
    const edited = updateBlockText(doc, doc.blocks[0].id, "longer before target");
    expect(locateChatNodeRange(edited, node)).toMatchObject({ ok: true, start: 14 });
    expect(locateChatNodeRange(updateBlockText(doc, doc.blocks[1].id, "changed"), node).ok).toBe(false);
    expect(locateChatNodeRange({ ...doc, blocks: [doc.blocks[0], doc.blocks[2]] }, node).ok).toBe(false);
    expect(locateChatNodeRange({ ...doc, blocks: [doc.blocks[0], doc.blocks[2], doc.blocks[1]] }, node).ok).toBe(false);
    expect(locateChatNodeRange({ ...doc, blocks: [doc.blocks[0], { ...doc.blocks[1], id: "inserted" }, ...doc.blocks.slice(1)] }, node).ok).toBe(false);
  });

  it("跨段保留硬换行和空段，不将选区扩大到未选中的段落", () => {
    const doc = createDocument("t", ["first\nline", "", "last", "outside"]);
    const node = multiNode(doc);
    expect(locateChatNodeRange(doc, node)).toMatchObject({ ok: true, segments: [
      { blockId: doc.blocks[0].id, start: 0, end: 10 },
      { blockId: doc.blocks[2].id, start: 0, end: 4 },
    ] });
  });

  it("相同短语重复出现时按编辑器记录的位置恢复指定选区", () => {
    const text = "first target, second target.";
    const doc = createDocument("t", [text]);
    const second = text.lastIndexOf("target");
    const hit = locateChatNodeRange(doc, rangeNode(doc, "target", second));

    expect(hit).toEqual({
      ok: true,
      blockId: doc.blocks[0].id,
      start: second,
      end: second + "target".length,
    });
  });

  it("选区前插入文本后仍能迁移到同一个重复短语", () => {
    const text = "first target, second target.";
    const doc = createDocument("t", [text]);
    const second = text.lastIndexOf("target");
    const node = rangeNode(doc, "target", second);
    const edited = updateBlockText(doc, doc.blocks[0].id, `prefix ${text}`);
    const hit = locateChatNodeRange(edited, node);

    expect(hit.ok).toBe(true);
    if (hit.ok) {
      expect(edited.blocks[0].text.slice(hit.start, hit.end)).toBe("target");
      expect(hit.start).toBe(second + "prefix ".length);
    }
  });

  it("选区后的正文发生变化时保留原位置", () => {
    const text = "first target, second target.";
    const doc = createDocument("t", [text]);
    const first = text.indexOf("target");
    const node = rangeNode(doc, "target", first);
    const edited = updateBlockText(
      doc,
      doc.blocks[0].id,
      text.replace("second", "updated second"),
    );
    const hit = locateChatNodeRange(edited, node);

    expect(hit).toMatchObject({ ok: true, start: first });
  });

  it("旧节点没有定位证据时保持保守，重复文本仍返回 ambiguous", () => {
    const text = "first target, second target.";
    const doc = createDocument("t", [text]);
    const node = rangeNode(doc, "target", text.indexOf("target"));
    delete node.rangeLocator;

    expect(locateChatNodeRange(doc, node)).toMatchObject({
      ok: false,
      reason: "ambiguous",
    });
  });

  it("选中文字确实被删除后返回 original_not_found", () => {
    const text = "keep target here";
    const doc = createDocument("t", [text]);
    const node = rangeNode(doc, "target", text.indexOf("target"));
    const edited = updateBlockText(doc, doc.blocks[0].id, "keep nothing here");

    expect(locateChatNodeRange(edited, node)).toMatchObject({
      ok: false,
      reason: "original_not_found",
    });
  });
});
