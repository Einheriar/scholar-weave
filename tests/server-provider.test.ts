import { afterEach, expect, it, vi } from "vitest";
import type { ProxyAgent } from "undici";
import { getProviderFromEnv, getProviderFromUserConfig } from "@/lib/llm/provider";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each(["user", "env"])("keeps the Node proxy transport for %s configuration", async (source) => {
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:7890");
  vi.stubEnv("SOCKS5_PROXY", "");
  const provider = source === "env"
    ? getProviderFromEnv()
    : getProviderFromUserConfig({
      apiKey: "sk-test",
      proxy: { type: "http", host: "127.0.0.1", port: 7890 },
    });
  let dispatcher: ProxyAgent | undefined;
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    dispatcher = options.dispatcher;
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
  }));

  try {
    await expect(provider.generate([{ role: "user", content: "hi" }])).resolves.toBe("ok");
    expect(dispatcher?.dispatch).toBeTypeOf("function");
  } finally {
    await dispatcher?.close();
  }
});
