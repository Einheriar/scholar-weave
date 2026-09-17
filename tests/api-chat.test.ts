import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/chat/route";
import * as providerMod from "@/lib/llm/provider";
import type { LLMProvider } from "@/lib/llm/provider";

/**
 * /api/chat 的服务端测试（PLAN 7 / 12）。
 * 重点：三种回复形态、修改集只返回待预览、定位不到的 edit 被剔除、
 * 不直接改正文（服务端只返回数据）。
 */

const BLOCKS = [
  { id: "p_a", text: "这些结果共同的表明该效应存在。" },
  { id: "p_b", text: "Deception is a two-person interaction." },
];

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    documentId: "doc_1",
    revision: 2,
    checksum: "abc",
    context: { type: "document" },
    message: "你好",
    history: [],
    blocks: BLOCKS,
    language: "zh",
    ...overrides,
  };
}

function mockProvider(content: string): LLMProvider {
  return { name: "mock", generate: vi.fn(async () => content) };
}

beforeEach(() => vi.restoreAllMocks());

describe("POST /api/chat", () => {
  it("answer 形态：纯解释，不含修改集", async () => {
    vi.spyOn(providerMod, "getProviderFromEnv").mockReturnValue(
      mockProvider(JSON.stringify({ type: "answer", answer: "这是解释。" })),
    );
    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.type).toBe("answer");
    expect(data.answer).toBe("这是解释。");
    expect(data.changeSet).toBeUndefined();
  });

  it("answer_with_review：返回服务端编号的候选审阅意见", async () => {
    vi.spyOn(providerMod, "getProviderFromEnv").mockReturnValue(
      mockProvider(
        JSON.stringify({
          type: "answer_with_review",
          answer: "讨论已经收敛为一个可执行的建议。",
          reviewProposal: {
            id: "model-controlled-id",
            title: "统一脑区缩写形式",
            explanation: "同一段内应统一使用缩写，以维持并列结构。",
            category: "consistency",
            severity: "suggestion",
          },
        }),
      ),
    );

    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({
      type: "answer_with_review",
      answer: "讨论已经收敛为一个可执行的建议。",
      reviewProposal: {
        title: "统一脑区缩写形式",
        explanation: "同一段内应统一使用缩写，以维持并列结构。",
        category: "consistency",
        severity: "suggestion",
      },
    });
    expect(data.reviewProposal.id).toMatch(/^proposal_/);
    expect(data.reviewProposal.id).not.toBe("model-controlled-id");
    expect(data.reviewProposal.convertedReviewId).toBeUndefined();
  });

  it("answer_with_changes：返回待预览修改集，含可定位的 edit", async () => {
    const payload = {
      type: "answer_with_changes",
      answer: "已按你的要求修改。",
      changeSet: {
        summary: "删除多余助词",
        edits: [
          {
            id: "c1",
            blockId: "p_a",
            original: "共同的表明",
            replacement: "共同表明",
            explanation: "删“的”",
          },
        ],
      },
    };
    vi.spyOn(providerMod, "getProviderFromEnv").mockReturnValue(
      mockProvider(JSON.stringify(payload)),
    );
    const res = await POST(makeReq(validBody()));
    const data = await res.json();
    expect(data.type).toBe("answer_with_changes");
    expect(data.changeSet.edits).toHaveLength(1);
    expect(data.changeSet.edits[0].status).toBe("pending");
    expect(data.changeSet.documentRevision).toBe(2);
    expect(data.changeSet.id).toMatch(/^cs_/);
  });

  it("定位不到的 edit 被剔除出修改集", async () => {
    const payload = {
      type: "answer_with_changes",
      answer: "…",
      changeSet: {
        summary: "s",
        edits: [
          { id: "c1", blockId: "p_a", original: "共同的表明", replacement: "共同表明", explanation: "" },
          { id: "c2", blockId: "p_a", original: "不存在的文本", replacement: "x", explanation: "" },
        ],
      },
    };
    vi.spyOn(providerMod, "getProviderFromEnv").mockReturnValue(
      mockProvider(JSON.stringify(payload)),
    );
    const res = await POST(makeReq(validBody()));
    const data = await res.json();
    expect(data.changeSet.edits).toHaveLength(1);
    expect(data.changeSet.edits[0].id).toMatch(/^edit_/);
    expect(data.changeSet.edits[0].id).not.toBe("c1");
  });

  it("忽略模型 edit ID，并透传 reasoningEffort", async () => {
    const payload = {
      type: "answer_with_changes",
      answer: "…",
      changeSet: {
        summary: "s",
        edits: [
          { id: "same-id", blockId: "p_a", original: "共同的表明", replacement: "共同表明", explanation: "" },
          { id: "same-id", blockId: "p_a", original: "该效应存在", replacement: "该效应确实存在", explanation: "" },
        ],
      },
    };
    const gen = vi.fn<LLMProvider["generate"]>(async () => JSON.stringify(payload));
    vi.spyOn(providerMod, "getProviderFromUserConfig").mockReturnValue({
      name: "mock",
      generate: gen,
    });
    const res = await POST(
      makeReq(
        validBody({
          llmConfig: { apiKey: "test-key", reasoningEffort: "high" },
        }),
      ),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    const ids = data.changeSet.edits.map((e: { id: string }) => e.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id: string) => id.startsWith("edit_"))).toBe(true);
    expect(ids).not.toContain("same-id");
    expect(gen.mock.calls[0][1]).toMatchObject({ reasoningEffort: "high" });
  });

  it("模型省略 edit ID 时仍由服务端生成", async () => {
    const payload = {
      type: "answer_with_changes",
      answer: "…",
      changeSet: {
        summary: "s",
        edits: [
          {
            blockId: "p_a",
            original: "共同的表明",
            replacement: "共同表明",
            explanation: "",
          },
        ],
      },
    };
    vi.spyOn(providerMod, "getProviderFromEnv").mockReturnValue(
      mockProvider(JSON.stringify(payload)),
    );
    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(200);
    expect((await res.json()).changeSet.edits[0].id).toMatch(/^edit_/);
  });

  it("review 上下文会把关联建议写入 prompt", async () => {
    const gen = vi.fn(async (messages: Array<{ content: string }>) => {
      void messages;
      return JSON.stringify({ type: "answer", answer: "ok" });
    });
    vi.spyOn(providerMod, "getProviderFromEnv").mockReturnValue({
      name: "mock",
      generate: gen,
    });
    await POST(
      makeReq(
        validBody({
          context: { type: "review", reviewId: "r1", blockId: "p_a" },
          reviewItem: {
            id: "r1",
            title: "删除多余助词",
            explanation: "这里不需要“的”",
            category: "grammar",
          },
        }),
      ),
    );
    const sys = gen.mock.calls[0][0][0].content;
    expect(sys).toContain("删除多余助词");
    expect(sys).toContain("审阅建议");
  });

  it("参数不合法 → 400", async () => {
    const res = await POST(makeReq({ documentId: "x" }));
    expect(res.status).toBe(400);
  });

  it("LLM 返回非协议结构 → 502", async () => {
    vi.spyOn(providerMod, "getProviderFromEnv").mockReturnValue(
      mockProvider(JSON.stringify({ type: "weird" })),
    );
    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(502);
  });

  it("内容超长 → 413", async () => {
    const res = await POST(
      makeReq(validBody({ blocks: [{ id: "p_x", text: "字".repeat(60_001) }] })),
    );
    expect(res.status).toBe(413);
  });
});
