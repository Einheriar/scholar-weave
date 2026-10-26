import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as review } from "@/app/api/review/route";
import { POST as chat } from "@/app/api/chat/route";
import { POST as changeSet } from "@/app/api/change-set/route";
import { POST as testConnection } from "@/app/api/test-connection/route";
import { CHAT_SESSION_HEADER, openCodeSessionId } from "@/lib/llm/opencode";

const baseURL = "https://opencode.ai/inference/go/openai/v1";
const llmConfig = { apiKey: "sk-test", baseURL, model: "test-model" };
const edits = [{ blockId: "p1", original: "Old text.", replacement: "New text.", explanation: "Improve wording." }];
const handlers = { review, chat, changeSet, testConnection };
const outputs = {
  review: { documentSummary: "Summary", items: [] },
  chat: { type: "answer", answer: "Answer" },
  changeSet: { summary: "Revision", edits },
  testConnection: "ok",
};

function request(sessionId?: string, useEnv = false) {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(sessionId ? { [CHAT_SESSION_HEADER]: sessionId } : {}),
    },
    body: JSON.stringify({
      documentId: "doc1", revision: 0, checksum: "abc", mode: "proofread",
      blocks: [{ id: "p1", text: "Old text." }],
      context: { type: "document" }, message: "Explain", history: [],
      sourceReview: { id: "r1", title: "Revise", explanation: "Improve wording.", category: "style", scope: { type: "document" } },
      ...(useEnv ? {} : { llmConfig }),
    }),
  });
}

function response(content: unknown) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("OpenCode endpoint detection", () => {
  it.each([
    baseURL,
    "https://opencode.ai/inference/openai/v1/",
    "https://opencode.ai/zen/go/v1",
    "https://opencode.ai/zen/v1",
  ])("recognizes %s", (url) => {
    expect(openCodeSessionId(url, "node_a")).toBe("ses_node_a");
  });

  it.each([
    "https://api.deepseek.com/v1",
    "https://opencode.ai.example.com/inference/go/openai/v1",
    "https://opencode.ai@example.com/inference/go/openai/v1",
    "https://example.com/v1?next=https://opencode.ai/inference",
    "https://opencode.ai/inference-other",
    "https://opencode.ai/docs/go",
    "not a URL",
  ])("does not add provider metadata to %s", (url) => {
    expect(openCodeSessionId(url, "node_a")).toBeUndefined();
  });

  it.each([undefined, "bad id", "bad\r\nheader", "x".repeat(129)])("generates an opaque ID for invalid or missing identity %s", (id) => {
    expect(openCodeSessionId(baseURL, id)).toMatch(/^ses_[0-9a-f-]{36}$/);
  });
});

describe("OpenCode server requests", () => {
  it.each(Object.keys(handlers) as (keyof typeof handlers)[])("adds a standalone session to %s", async (kind) => {
    const fetchMock = vi.fn().mockImplementation(async () => response(outputs[kind]));
    vi.stubGlobal("fetch", fetchMock);
    const result = await handlers[kind](request());
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(`${baseURL}/chat/completions`, expect.any(Object));
    const init = fetchMock.mock.calls[0][1];
    const id = new Headers(init.headers).get("x-opencode-session");
    expect(id).toMatch(/^ses_[0-9a-f-]{36}$/);
    expect(JSON.parse(init.body).model).toBe("test-model");
    expect(init.body).not.toContain(id);
    expect(init.body).not.toContain(CHAT_SESSION_HEADER);
  });

  it.each([false, true])("keeps conversation IDs stable across requests with env=%s", async (useEnv) => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENAI_BASE_URL", baseURL);
    for (const key of ["SOCKS5_PROXY", "HTTPS_PROXY", "HTTP_PROXY"]) vi.stubEnv(key, "");
    const fetchMock = vi.fn().mockImplementation(async () => response(outputs.chat));
    vi.stubGlobal("fetch", fetchMock);
    for (const id of ["node_a", "node_a", "node_b"]) {
      expect((await chat(request(id, useEnv))).status).toBe(200);
    }
    expect(fetchMock.mock.calls.map(([, init]) => new Headers(init.headers).get("x-opencode-session")))
      .toEqual(["ses_node_a", "ses_node_a", "ses_node_b"]);
  });

  it("reuses one standalone ID for structured repair and isolates the next request", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response("invalid JSON"))
      .mockImplementation(async () => response(outputs.review));
    vi.stubGlobal("fetch", fetchMock);
    expect((await review(request())).status).toBe(200);
    expect((await review(request())).status).toBe(200);
    const ids = fetchMock.mock.calls.map(([, init]) => new Headers(init.headers).get("x-opencode-session"));
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });
});
