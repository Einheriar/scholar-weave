import { describe, expect, it } from "vitest";
import { deriveNodeTitle, findNodeByAnchor } from "@/lib/chat-nodes";
import type { ChatContext, ChatNode } from "@/lib/review-schema";

/** 构造一个最小节点，只关心 anchor / originalText */
function node(id: string, anchor: ChatContext, originalText = ""): ChatNode {
  return {
    id,
    anchor,
    originalText,
    createdAt: "2026-09-15T10:00:00.000Z",
    turns: [],
  };
}

describe("节点身份判定（规则 8）", () => {
  const nodes: ChatNode[] = [
    node("n_review", { type: "review", reviewId: "rev_1" }),
    node("n_range", { type: "range", blockId: "p_1", selectedText: "upstanding" }),
    node("n_block", { type: "block", blockId: "p_2" }),
    node("n_doc", { type: "document" }),
  ];

  it("review 锚按 reviewId 认：同一建议的提问永远接同一条线", () => {
    expect(
      findNodeByAnchor(nodes, { type: "review", reviewId: "rev_1" })?.id,
    ).toBe("n_review");
    // 换一条建议 → 不是同一节点
    expect(
      findNodeByAnchor(nodes, { type: "review", reviewId: "rev_2" }),
    ).toBeNull();
  });

  it("range 锚仅按选区原文逐字相同认（blockId / 位置不参与）", () => {
    // 同一原文，即便 blockId 不同 / 位置不同，也算同一节点
    expect(
      findNodeByAnchor(nodes, { type: "range", blockId: "p_9", selectedText: "upstanding" })?.id,
    ).toBe("n_range");
  });

  it("range 锚选中另一段文字（原文不同）就开新行", () => {
    expect(
      findNodeByAnchor(nodes, { type: "range", blockId: "p_1", selectedText: "deceptive" }),
    ).toBeNull();
  });

  it("range 锚 selectedText 为空时找不到节点", () => {
    expect(findNodeByAnchor(nodes, { type: "range", blockId: "p_1" })).toBeNull();
  });

  it("block 锚按 blockId 认：同一段反复问 = 同一节点", () => {
    expect(findNodeByAnchor(nodes, { type: "block", blockId: "p_2" })?.id).toBe("n_block");
    expect(findNodeByAnchor(nodes, { type: "block", blockId: "p_3" })).toBeNull();
  });

  it("document 锚整篇共用固定全文档节点", () => {
    expect(findNodeByAnchor(nodes, { type: "document" })?.id).toBe("n_doc");
    expect(findNodeByAnchor([], { type: "document" })).toBeNull();
  });
});

describe("节点标题派生（时间线 hover 摘要）", () => {
  it("优先取 originalText 快照并截断", () => {
    expect(deriveNodeTitle(node("n", { type: "range" }, "upstanding citizen"))).toBe(
      "upstanding c…",
    );
  });

  it("快照为空时按锚点类型给占位", () => {
    expect(deriveNodeTitle(node("n", { type: "range", selectedText: "moral" }))).toBe("moral");
    expect(deriveNodeTitle(node("n", { type: "block" }))).toBe("段落讨论");
    expect(deriveNodeTitle(node("n", { type: "review" }))).toBe("建议讨论");
    expect(deriveNodeTitle(node("n", { type: "document" }))).toBe("全文讨论");
  });
});
