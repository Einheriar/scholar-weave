import { afterEach, expect, it, vi } from "vitest";
import { callChat, callReview, callChangeSet, testConnection } from "@/lib/api-client";
import { CHAT_SESSION_HEADER } from "@/lib/llm/opencode";

// A client import must not evaluate Node-only transports, even with a proxy configured.
vi.mock("undici", () => {
  throw new Error("Node-only undici was loaded by the client");
});

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("uses the Tauri HTTP transport and proxy without loading undici", async () => {
  vi.stubGlobal("__TAURI__", {});
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
  vi.mocked(tauriFetch).mockResolvedValue(
    new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] })),
  );
  const browserFetch = vi.fn();
  vi.stubGlobal("fetch", browserFetch);

  await expect(testConnection({
    llmConfig: {
      apiKey: "sk-test",
      baseURL: "https://provider.example/v1",
      model: "test-model",
      proxy: { type: "socks5", host: "127.0.0.1", port: 1080 },
    },
  })).resolves.toEqual({ ok: true });

  expect(tauriFetch).toHaveBeenCalledWith(
    "https://provider.example/v1/chat/completions",
    expect.objectContaining({ proxy: { all: "socks5://127.0.0.1:1080" } }),
  );
  expect(browserFetch).not.toHaveBeenCalled();
  expect(new Headers(vi.mocked(tauriFetch).mock.calls[0][1]?.headers).has("x-opencode-session")).toBe(false);
});

it("carries the node ID to the browser route without changing the JSON protocol", async () => {
  const body = { message: "Explain" };
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ type: "answer", answer: "ok" })));
  vi.stubGlobal("fetch", fetchMock);
  await callChat(body, undefined, "node_a");
  expect(fetchMock).toHaveBeenCalledWith("/api/chat", expect.objectContaining({
    headers: { "Content-Type": "application/json", [CHAT_SESSION_HEADER]: "node_a" },
    body: JSON.stringify(body),
  }));
});

it("keeps Tauri conversation sessions stable and separate with the proxy enabled", async () => {
  vi.stubGlobal("__TAURI__", {});
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
  vi.mocked(tauriFetch).mockImplementation(async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ type: "answer", answer: "ok" }) } }],
  })));
  const body = {
    documentId: "doc1", revision: 0, checksum: "abc", context: { type: "document" },
    message: "Explain", history: [], blocks: [{ id: "p1", text: "Old text." }],
    llmConfig: {
      apiKey: "sk-test", baseURL: "https://opencode.ai/inference/go/openai/v1", model: "test-model",
      proxy: { type: "http", host: "127.0.0.1", port: 7897 },
    },
  };
  for (const id of ["node_a", "node_a", "node_b"]) await callChat(body, undefined, id);
  expect(vi.mocked(tauriFetch).mock.calls.map(([, init]) => new Headers(init?.headers).get("x-opencode-session")))
    .toEqual(["ses_node_a", "ses_node_a", "ses_node_b"]);
  expect(tauriFetch).toHaveBeenCalledWith(
    `${body.llmConfig.baseURL}/chat/completions`,
    expect.objectContaining({ proxy: { all: "http://127.0.0.1:7897" } }),
  );
});

it.each(["review", "changeSet", "testConnection"] as const)("adds a standalone session to Tauri %s", async (kind) => {
  vi.stubGlobal("__TAURI__", {});
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
  const content = kind === "review" ? { documentSummary: "Summary", items: [] }
    : kind === "changeSet" ? { summary: "Revision", edits: [{ blockId: "p1", original: "Old text.", replacement: "New text.", explanation: "Improve wording." }] }
    : "ok";
  vi.mocked(tauriFetch).mockImplementation(async () => new Response(JSON.stringify({
    choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
  })));
  const body = {
    documentId: "doc1", revision: 0, checksum: "abc", mode: "proofread",
    blocks: [{ id: "p1", text: "Old text." }],
    sourceReview: { id: "r1", title: "Revise", explanation: "Improve wording.", category: "style", scope: { type: "document" } },
    llmConfig: { apiKey: "sk-test", baseURL: "https://opencode.ai/inference/go/openai/v1", model: "test-model" },
  };
  const call = { review: callReview, changeSet: callChangeSet, testConnection }[kind];
  await call(body);
  expect(new Headers(vi.mocked(tauriFetch).mock.calls[0][1]?.headers).get("x-opencode-session"))
    .toMatch(/^ses_[0-9a-f-]{36}$/);
});
