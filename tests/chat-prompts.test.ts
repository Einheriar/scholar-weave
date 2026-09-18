import { describe, expect, it } from "vitest";
import { ChatRequestSchema } from "@/lib/llm/chat-llm-schema";
import { buildChatMessages } from "@/lib/llm/chat-prompts";

function promptFor(includeFullDocument: boolean) {
  const request = ChatRequestSchema.parse({
    documentId: "doc_1",
    revision: 3,
    checksum: "checksum_3",
    context: {
      type: "range",
      blockId: "p_2",
      selectedText: "inter-brain synchrony",
    },
    includeFullDocument,
    message: "统一全文术语",
    history: [],
    blocks: [
      { id: "p_1", text: "Previous context." },
      { id: "p_2", text: "We measured inter-brain synchrony." },
      { id: "p_3", text: "Following context." },
    ],
    openReviews: [],
    language: "en",
  });
  return buildChatMessages(request)[0].content;
}

describe("chat prompt document scope", () => {
  it("局部模式明确区分可见上下文与可修改锚点，并给出全文请求拒绝文案", () => {
    const prompt = promptFor(false);
    expect(prompt).toContain("相邻段落仅供理解，不能修改");
    expect(prompt).toContain(
      "当前只提供了选区及相邻段落，我无法可靠检查或修改整篇文档。请开启“附带全文背景”后重新发送该要求。",
    );
    expect(prompt).toContain("answer_with_review");
    expect(prompt).toContain("answer_with_changes");
  });

  it("全文模式明确授权本轮全部最新 blocks 作为可见和可修改范围", () => {
    const prompt = promptFor(true);
    expect(prompt).toContain("发送时从最新正文快照提取的完整内容");
    expect(prompt).toContain("本轮已发送的全部段落都属于可见且可修改范围");
  });
});
