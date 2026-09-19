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
  it.each([false, true])("历史锚明确区分旧片段与当前正文，包含全文=%s", (includeFullDocument) => {
    const request = ChatRequestSchema.parse({
      documentId: "doc_1",
      revision: 4,
      checksum: "checksum_4",
      context: { type: "range", blockId: "p_1", selectedText: "Historical wording." },
      anchorStale: true,
      includeFullDocument,
      message: "Explain the changes.",
      history: [{ role: "assistant", content: "An earlier proposed rewrite." }],
      blocks: [{ id: "p_1", text: "Current wording." }],
    });
    const messages = buildChatMessages(request);
    const prompt = messages[0].content;
    expect(prompt).toContain("Historical selectedText (not a current selection)");
    expect(prompt).toContain("current document snapshot at send time");
    expect(prompt).toContain("Conversation history contains earlier exchanges only");
    expect(prompt).toContain("Return only answer, never answer_with_changes or answer_with_review");
    expect(prompt).toContain("never automatically re-anchor");
    expect(prompt).toContain("even with full-document background");
    expect(prompt).not.toContain("[Rewrite intent]");
    expect(prompt).not.toContain('"type": "answer_with_changes"');
    expect(prompt).not.toContain('"type": "answer_with_review"');
    expect(prompt).toContain("Historical quotations may be discussed.");
    expect(prompt).not.toContain("Every paragraph sent in this request is visible and may be modified.");
    expect(prompt).not.toMatch(/\p{Script=Han}/u);
    expect(prompt).toContain("Write explanations, headings, titles, and summaries in Chinese");
    expect(messages[1].content).toBe("An earlier proposed rewrite.");
    expect(messages.at(-1)?.content).toContain("Current wording.");
  });

  it("原段落缺失不暗示看到当前段落或全文，旧请求默认锚点有效", () => {
    const request = ChatRequestSchema.parse({
      documentId: "doc_1",
      revision: 4,
      checksum: "checksum_4",
      context: { type: "range", blockId: "deleted", selectedText: "Historical wording." },
      message: "Explain.",
      blocks: [],
    });
    expect(request.anchorStale).toBe(false);
    const prompt = buildChatMessages({ ...request, anchorStale: true, includeFullDocument: true })[0].content;
    expect(prompt).toContain("No current paragraphs were provided (blocks is empty)");
    expect(prompt).toContain("Do not claim to see its current contents or assume full-document context");
    expect(prompt).not.toContain("contain the complete document");
  });

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

  it("全文审阅意见无需另开全文开关，局部审阅意见仍限制在锚点段", () => {
    const request = ChatRequestSchema.parse({
      documentId: "doc_1", revision: 1, checksum: "c",
      context: { type: "review", reviewId: "review_1" },
      reviewItem: { id: "review_1", title: "Overall style", explanation: "Be concise.", category: "style" },
      message: "Please revise.",
      blocks: [{ id: "p_1", text: "First." }, { id: "p_2", text: "Second." }],
    });
    const full = buildChatMessages(request)[0].content;
    expect(full).toContain("The blocks contain the complete document");
    expect(full).toContain("Every paragraph sent in this request is visible and may be modified.");
    const local = buildChatMessages({ ...request, context: { ...request.context, blockId: "p_1" } })[0].content;
    expect(local).not.toContain("The blocks contain the complete document");
    expect(local).toContain("You may modify only the paragraph anchored by the review suggestion, blockId=p_1.");
  });

  it("重写须明确请求，英文备选正文与中文解释分开，权限不依赖开关操作来源", () => {
    const prompt = promptFor(true);
    expect(prompt).toContain("For an explicit complete rewrite request within the editable scope");
    expect(prompt).toContain("writing difficulties without an edit request");
    expect(prompt).toContain("Use Chinese headings and English passages.");
    expect(prompt).toContain("write replacement and rewrite alternatives in English");
    expect(prompt).not.toContain("only when the user explicitly enabled it");
    expect(prompt).not.toContain("or says they have a writing block");
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
    expect(prompt).toContain("Write explanations, headings, titles, and summaries in Chinese");
  });
});

describe("internal LLM prompt language", () => {
  it.each(["proofread", "polish", "deep_review"])("审阅模式 %s 保持意见范围与逐字锚点约束", (mode) => {
    const request = ReviewRequestSchema.parse({
      documentId: "doc_1",
      revision: 1,
      checksum: "checksum_1",
      mode,
      blocks: [{ id: "p_1", text: "A short paragraph." }],
    });
    const prompt = buildReviewMessages(request)[0].content;
    const scopeLines = prompt.split("\n").filter((line) => line.startsWith('- { "type":'));

    expect(scopeLines).toHaveLength(3);
    expect(scopeLines[0]).toContain("general feedback on the document's overall style");
    expect(scopeLines[0]).toContain('kind="opinion" without replacement');
    expect(scopeLines[1]).toContain('entire paragraph; normally use kind="opinion" without replacement');
    expect(scopeLines[2]).toContain('kind="opinion" without replacement, or kind="edit" with replacement');
    expect(prompt).toContain('"original" must be copied verbatim from the paragraph identified by blockId');
    expect(prompt).toContain("include the immediately adjacent prefix and/or suffix needed to identify it uniquely");
    expect(prompt).toContain("never invent a quote or promote them to document-level opinions");
    expect(prompt).toContain("IDs, status, and documentRevision are assigned by the application");
    expect(prompt).not.toContain("- id: a unique string");
    expect(prompt).toContain("A block edit replaces the entire paragraph.");
    expect(prompt).not.toContain("only then create a ChangeSet");
  });

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

  it.each(["block", "range", "document"])("%s 修改集使用英文指令并准确描述段落操作能力", (type) => {
    const request = ChangeSetRequestSchema.parse({
      documentId: "doc_1",
      revision: 1,
      checksum: "checksum_1",
      sourceReview: {
        id: "r1",
        title: "Improve the transition",
        explanation: "Make the relationship between the claims explicit.",
        category: "clarity",
        scope: { type, blockId: "p_1" },
      },
      blocks: [{ id: "p_1", text: "A short paragraph." }],
      language: "en",
    });

    const [system, user] = buildChangeSetMessages(request);
    expect(system.content).not.toMatch(/\p{Script=Han}/u);
    expect(user.content).not.toMatch(/\p{Script=Han}/u);
    expect(system.content).toContain("Write summary and every explanation in Chinese");
    expect(system.content).toContain("pending user confirmation");
    expect(system.content).toContain("edits cannot create, merge, delete, or reorder paragraph blocks");
    expect(system.content).not.toContain("When paragraphs must be merged or split");
    if (type === "range") expect(system.content).toContain("a passage in paragraph p_1");
  });
});
