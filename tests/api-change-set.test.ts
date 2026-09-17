import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/change-set/route";
import * as providerMod from "@/lib/llm/provider";
import type { LLMProvider } from "@/lib/llm/provider";

const BLOCKS = [
  { id: "p_a", text: "这些结果共同的表明该效应存在。" },
  { id: "p_b", text: "Deception is a two-person interaction." },
];

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/change-set", {
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
    sourceReview: {
      id: "review_1",
      title: "修改表达",
      explanation: "可以更清晰。",
      category: "clarity",
      scope: { type: "range", blockId: "p_a" },
    },
    instruction: "保持原意。",
    blocks: BLOCKS,
    language: "zh",
    ...overrides,
  };
}

beforeEach(() => vi.restoreAllMocks());

describe("POST /api/change-set", () => {
  it("LLM 首次返回非法 JSON 时自动纠错一次", async () => {
    const payload = {
      summary: "纠错后可用",
      edits: [
        {
          blockId: "p_a",
          original: "共同的表明",
          replacement: "共同表明",
          explanation: "删除多余助词。",
        },
      ],
    };
    const gen = vi
      .fn<LLMProvider["generate"]>()
      .mockResolvedValueOnce("not json")
      .mockResolvedValueOnce(JSON.stringify(payload));
    vi.spyOn(providerMod, "getProviderFromEnv").mockReturnValue({
      name: "mock",
      generate: gen,
    });

    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(200);
    expect((await res.json()).changeSet.summary).toBe("纠错后可用");
    expect(gen).toHaveBeenCalledTimes(2);
    expect(gen.mock.calls[1][1]).toMatchObject({ temperature: 0 });
  });

  it("忽略模型 edit ID，为重复 ID 重新生成唯一 ID，并透传 reasoningEffort", async () => {
    const payload = {
      summary: "改进表达",
      edits: [
        {
          id: "same-id",
          blockId: "p_a",
          original: "共同的表明",
          replacement: "共同表明",
          explanation: "删除多余助词。",
        },
        {
          id: "same-id",
          blockId: "p_a",
          original: "该效应存在",
          replacement: "该效应确实存在",
          explanation: "增强表达。",
        },
      ],
    };
    const gen = vi.fn<LLMProvider["generate"]>(async () => JSON.stringify(payload));
    vi.spyOn(providerMod, "getProviderFromUserConfig").mockReturnValue({
      name: "mock",
      generate: gen,
    });

    const res = await POST(
      makeReq(
        validBody({
          llmConfig: { apiKey: "test-key", reasoningEffort: "max" },
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
    expect(gen.mock.calls[0][1]).toMatchObject({ reasoningEffort: "max" });
  });

  it("模型省略 edit ID 时仍由服务端生成", async () => {
    const payload = {
      summary: "改进表达",
      edits: [
        {
          blockId: "p_a",
          original: "共同的表明",
          replacement: "共同表明",
          explanation: "删除多余助词。",
        },
      ],
    };
    vi.spyOn(providerMod, "getProviderFromEnv").mockReturnValue({
      name: "mock",
      generate: vi.fn(async () => JSON.stringify(payload)),
    });

    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(200);
    expect((await res.json()).changeSet.edits[0].id).toMatch(/^edit_/);
  });
});
