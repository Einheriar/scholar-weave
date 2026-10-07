import { afterEach, expect, it, vi } from "vitest";
import { testConnection } from "@/lib/api-client";

// A client import must not evaluate Node-only transports, even with a proxy configured.
vi.mock("undici", () => {
  throw new Error("Node-only undici was loaded by the client");
});

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
});
