import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/review/route";
import * as providerMod from "@/lib/llm/provider";
import type { LLMProvider } from "@/lib/llm/provider";

/**
 * /api/review 的服务端测试（PLAN 12 / 15）。
 * 用 mock provider 隔离真实网络，重点验证：
 * - 输入校验与规模限制；
 * - LLM 输出的 Zod 校验；
 * - 无法精确定位的 edit 被丢弃而不是乱替换（10.3）；
 * - 统一错误结构；opinion/edit 约束。
 */

const BLOCKS = [
  { id: "p_a", text: "这些结果共同的表明该效应存在。" },
  { id: "p_b", text: "Deception is a two-person interaction." },
];

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    documentId: "doc_1",
    revision: 3,
    checksum: "abc",
    mode: "deep_review",
    language: "zh",
    style: "学术",
    preserveTerms: [],
    blocks: BLOCKS,
    ...overrides,
  };
}

function mockProvider(content: string): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn(async () => content),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/review", () => {
  it("非法 JSON → 400 bad_json", async () => {
    const res = await POST(
      new Request("http://localhost/api/review", {
        method: "POST",
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_json");
  });

  it("参数不合法 → 400 invalid_request", async () => {
    const res = await POST(makeReq({ documentId: "x" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
  });

  it("空文档 → 400 empty_document", async () => {
    const res = await POST(makeReq(validBody({ blocks: [] })));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("empty_document");
  });

  it("字数超限 → 413 too_long", async () => {
    const big = [{ id: "p_x", text: "字".repeat(60_001) }];
    const res = await POST(makeReq(validBody({ blocks: big })));
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("too_long");
  });

  it("LLM 返回非 JSON → 502 llm_bad_json", async () => {
    vi.spyOn(providerMod, "getProviderFromEnv").mockReturnValue(
      mockProvider("这不是 JSON"),
    );
    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("llm_bad_json");
  });

  it("LLM 返回结构不符 → 502 llm_schema_mismatch", async () => {
    vi.spyOn(providerMod, "getProviderFromEnv").mockReturnValue(
      mockProvider(JSON.stringify({ foo: 1 })),
    );
    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("llm_schema_mismatch");
  });

  it("LLM 调用抛错 → 502 llm_error（不泄露内部细节）", async () => {
    vi.spyOn(providerMod, "getProviderFromEnv").mockReturnValue({
      name: "mock",
      generate: vi.fn(async () => {
        throw new Error("upstream exploded");
      }),
    });
    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("llm_error");
  });

  it("正常流程：返回带 status/documentRevision 的完整建议", async () => {
    const payload = {
      documentSummary: "整体清晰。",
      items: [
        {
          id: "r1",
          scope: { type: "document" },
          kind: "opinion",
          category: "structure",
          severity: "suggestion",
          title: "结构可优化",
          explanation: "…",
        },
        {
          id: "r2",
          scope: {
            type: "range",
            blockId: "p_a",
            original: "共同的表明",
          },
          kind: "edit",
          category: "grammar",
          severity: "important",
          title: "删多余助词",
          explanation: "…",
          replacement: "共同表明",
        },
      ],
    };
    vi.spyOn(providerMod, "getProviderFromEnv").mockReturnValue(
      mockProvider(JSON.stringify(payload)),
    );
    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.documentSummary).toBe("整体清晰。");
    expect(data.items).toHaveLength(2);
    // 服务端填充 status / documentRevision
    expect(data.items[0].status).toBe("open");
    expect(data.items[0].documentRevision).toBe(3);
  });

  it("无法精确定位的 edit 被丢弃（不猜测位置）", async () => {
    const payload = {
      documentSummary: "…",
      items: [
        {
          id: "r_ok",
          scope: { type: "range", blockId: "p_a", original: "共同的表明" },
          kind: "edit",
          category: "grammar",
          severity: "important",
          title: "可定位",
          explanation: "…",
          replacement: "共同表明",
        },
        {
          id: "r_noexist",
          scope: { type: "range", blockId: "p_a", original: "根本不存在的文本" },
          kind: "edit",
          category: "grammar",
          severity: "info",
          title: "定位不到",
          explanation: "…",
          replacement: "x",
        },
        {
          id: "r_badblock",
          scope: { type: "range", blockId: "p_无此段", original: "共同的表明" },
          kind: "edit",
          category: "grammar",
          severity: "info",
          title: "段落不存在",
          explanation: "…",
          replacement: "x",
        },
      ],
    };
    vi.spyOn(providerMod, "getProviderFromEnv").mockReturnValue(
      mockProvider(JSON.stringify(payload)),
    );
    const res = await POST(makeReq(validBody()));
    const data = await res.json();
    const ids = data.items.map((i: { id: string }) => i.id);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(/^review_/);
    expect(ids).not.toContain("r_ok");
    expect(ids).not.toContain("r_noexist");
    expect(ids).not.toContain("r_badblock");
  });

  it("忽略模型建议 ID，并为重复 ID 重新生成唯一 ID", async () => {
    const payload = {
      documentSummary: "…",
      items: [
        {
          id: "same-id",
          scope: { type: "document" },
          kind: "opinion",
          category: "structure",
          severity: "info",
          title: "意见一",
          explanation: "…",
        },
        {
          id: "same-id",
          scope: { type: "document" },
          kind: "opinion",
          category: "clarity",
          severity: "info",
          title: "意见二",
          explanation: "…",
        },
      ],
    };
    vi.spyOn(providerMod, "getProviderFromEnv").mockReturnValue(
      mockProvider(JSON.stringify(payload)),
    );
    const res = await POST(makeReq(validBody()));
    const ids = (await res.json()).items.map((i: { id: string }) => i.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id: string) => id.startsWith("review_"))).toBe(true);
    expect(ids).not.toContain("same-id");
  });

  it("模型省略 ID 时仍由服务端生成建议 ID", async () => {
    const payload = {
      documentSummary: "…",
      items: [
        {
          scope: { type: "document" },
          kind: "opinion",
          category: "structure",
          severity: "info",
          title: "无需模型分配 ID",
          explanation: "…",
        },
      ],
    };
    vi.spyOn(providerMod, "getProviderFromEnv").mockReturnValue(
      mockProvider(JSON.stringify(payload)),
    );
    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(200);
    expect((await res.json()).items[0].id).toMatch(/^review_/);
  });

  it("违反业务约束的建议被丢弃（edit 用 document scope / opinion 带 replacement）", async () => {
    const payload = {
      documentSummary: "…",
      items: [
        {
          id: "r_badscope",
          scope: { type: "document" },
          kind: "edit",
          category: "grammar",
          severity: "info",
          title: "edit 不应是 document 范围",
          explanation: "…",
          replacement: "x",
        },
        {
          id: "r_badkind",
          scope: { type: "document" },
          kind: "opinion",
          category: "structure",
          severity: "info",
          title: "opinion 不应带 replacement",
          explanation: "…",
          replacement: "x",
        },
      ],
    };
    vi.spyOn(providerMod, "getProviderFromEnv").mockReturnValue(
      mockProvider(JSON.stringify(payload)),
    );
    const res = await POST(makeReq(validBody()));
    const data = await res.json();
    expect(data.items).toHaveLength(0);
  });

  it("保留术语要求体现在 prompt 中（防 LLM 改动，重点场景 9）", async () => {
    const payload = { documentSummary: "…", items: [] };
    const gen = vi.fn(
      async (messages: Array<{ content: string }>) => {
        void messages;
        return JSON.stringify(payload);
      },
    );
    vi.spyOn(providerMod, "getProviderFromEnv").mockReturnValue({
      name: "mock",
      generate: gen,
    });
    await POST(makeReq(validBody({ preserveTerms: ["in-group favoritism"] })));
    const messages = gen.mock.calls[0][0];
    const sys = messages[0].content;
    expect(sys).toContain("in-group favoritism");
    expect(sys).toContain("不得修改");
  });
});
