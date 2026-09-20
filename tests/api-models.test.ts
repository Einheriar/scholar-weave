import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/models/route";
import { normalizeModelIds } from "@/lib/llm/model-list";

function makeReq(body: unknown, init: RequestInit = {}): Request {
  return new Request("http://localhost/api/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...init,
  });
}

const validBody = {
  apiKey: "sk-test-secret",
  baseURL: "https://provider.example/v1/",
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("normalizeModelIds", () => {
  it("accepts OpenAI data entries, trims, deduplicates, and sorts IDs", () => {
    expect(
      normalizeModelIds({
        data: [
          { id: " zeta " },
          { id: "alpha" },
          { id: "alpha" },
          { id: "" },
          { id: 42 },
          "beta",
        ],
      }),
    ).toEqual(["alpha", "beta", "zeta"]);
  });

  it("accepts a top-level array or models array and rejects malformed payloads", () => {
    expect(normalizeModelIds(["b", "a"])).toEqual(["a", "b"]);
    expect(normalizeModelIds({ models: [{ id: "local-model" }] })).toEqual([
      "local-model",
    ]);
    expect(() => normalizeModelIds({ data: "not-an-array" })).toThrow();
  });
});

describe("POST /api/models", () => {
  it("requests the normalized /models URL with the user key and returns model IDs", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://provider.example/v1/models");
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer sk-test-secret",
      );
      return new Response(JSON.stringify({ data: [{ id: "model-b" }, { id: "model-a" }] }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(makeReq(validBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ models: ["model-a", "model-b"] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows public/local providers with an empty key without adding Authorization", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toEqual({ Accept: "application/json" });
      return new Response(JSON.stringify({ data: [{ id: "local-model" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(makeReq({ apiKey: "", baseURL: "http://127.0.0.1:11434/v1" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ models: ["local-model"] });
  });

  it("passes the configured HTTP/SOCKS proxy dispatcher to fetch", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect((init as RequestInit & { dispatcher?: unknown }).dispatcher).toBeTruthy();
      return new Response(JSON.stringify({ data: [{ id: "proxy-model" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      makeReq({
        ...validBody,
        proxy: { type: "socks5", host: "127.0.0.1", port: 1080 },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ models: ["proxy-model"] });
  });

  it("rejects invalid URLs before making a network request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(makeReq({ ...validBody, baseURL: "file:///secret" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_base_url");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sanitizes upstream failures and payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "sk-test-secret leaked" }), { status: 401 }),
      ),
    );

    const response = await POST(makeReq(validBody));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error.code).toBe("models_error");
    expect(body.error.message).not.toContain("sk-test-secret");
  });

  it("maps client cancellation to a standard error", async () => {
    const abort = new AbortController();
    abort.abort();
    const response = await POST(makeReq(validBody, { signal: abort.signal }));
    expect(response.status).toBe(499);
    expect((await response.json()).error).toEqual({
      code: "client_aborted",
      message: "请求已取消。",
    });
  });

  it("aborts a slow provider request after the route timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const pending = POST(makeReq(validBody));
    for (let i = 0; i < 5 && fetchMock.mock.calls.length === 0; i += 1) {
      await Promise.resolve();
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);

    const response = await pending;
    expect(response.status).toBe(504);
    expect((await response.json()).error).toEqual({
      code: "models_timeout",
      message: "获取模型列表超时，请检查网络或代理设置。",
    });
  });
});
