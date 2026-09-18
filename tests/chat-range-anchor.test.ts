import { describe, expect, it } from "vitest";
import {
  createChatRangeLocator,
  locateChatNodeRange,
} from "@/lib/chat-range-anchor";
import { createDocument, updateBlockText } from "@/lib/revisions";
import type { ChatNode, DocumentState } from "@/lib/review-schema";

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
