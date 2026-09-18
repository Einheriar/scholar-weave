import { describe, expect, it } from "vitest";
import {
  ChangeSetRequestSchema,
  ChatRequestSchema,
} from "@/lib/llm/chat-llm-schema";
import {
  buildChangeSetMessages,
  buildChatMessages,
} from "@/lib/llm/chat-prompts";
import { buildReviewMessages } from "@/lib/llm/prompts";
import { ReviewRequestSchema } from "@/lib/llm/review-llm-schema";

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
    expect(prompt).toContain(
      "Adjacent paragraphs are context only and must not be modified.",
    );
    expect(prompt).toContain(
      "only the selection and adjacent paragraphs were provided",
    );
    expect(prompt).toContain("answer_with_review");
    expect(prompt).toContain("answer_with_changes");
  });

  it("全文模式明确授权本轮全部最新 blocks 作为可见和可修改范围", () => {
    const prompt = promptFor(true);
    expect(prompt).toContain(
      "complete document taken from the latest snapshot at send time",
    );
    expect(prompt).toContain(
      "Every paragraph sent in this request is visible and may be modified.",
    );
  });

  it("机械性批量替换要求逐处生成最小 edit", () => {
    const prompt = promptFor(true);
    expect(prompt).toContain("return one edit for every occurrence");
    expect(prompt).toContain(
      "never combine multiple occurrences into a sentence- or paragraph-level replacement",
    );
  });

  it("聊天系统指令使用英文，同时要求用户可见回复使用中文", () => {
    const prompt = promptFor(true);
    expect(prompt).not.toMatch(/\p{Script=Han}/u);
    expect(prompt).toContain("Write every user-facing text field in Chinese");
  });
});

describe("internal LLM prompt language", () => {
  it("审阅的系统指令与固定用户信封均使用英文", () => {
    const request = ReviewRequestSchema.parse({
      documentId: "doc_1",
      revision: 1,
      checksum: "checksum_1",
      mode: "proofread",
      language: "en",
      preserveTerms: [],
      blocks: [{ id: "p_1", text: "A short paragraph." }],
    });

    const [system, user] = buildReviewMessages(request);
    expect(system.content).not.toMatch(/\p{Script=Han}/u);
    expect(user.content).not.toMatch(/\p{Script=Han}/u);
    expect(system.content).toContain(
      "Write documentSummary, title, and explanation in Chinese",
    );
  });

  it("修改集的系统指令与固定用户信封均使用英文", () => {
    const request = ChangeSetRequestSchema.parse({
      documentId: "doc_1",
      revision: 1,
      checksum: "checksum_1",
      sourceReview: {
        id: "r1",
        title: "Improve the transition",
        explanation: "Make the relationship between the claims explicit.",
        category: "clarity",
        scope: { type: "block", blockId: "p_1" },
      },
      blocks: [{ id: "p_1", text: "A short paragraph." }],
      language: "en",
    });

    const [system, user] = buildChangeSetMessages(request);
    expect(system.content).not.toMatch(/\p{Script=Han}/u);
    expect(user.content).not.toMatch(/\p{Script=Han}/u);
    expect(system.content).toContain("Write summary and every explanation in Chinese");
  });
});
