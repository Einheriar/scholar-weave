import { afterEach, expect, it, vi } from "vitest";
import type { ProxyAgent } from "undici";
import { getProviderFromEnv, getProviderFromUserConfig } from "@/lib/llm/provider";
import { OpenAIProvider } from "@/lib/llm/openai-provider";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each([
  ["UND_ERR_CONNECT_TIMEOUT", "连接超时"],
  ["UND_ERR_SOCKET", "连接被中断"],
  ["ECONNRESET", "连接被重置"],
  ["ECONNREFUSED", "连接被拒绝"],
  ["ENOTFOUND", "无法解析"],
  ["CERT_HAS_EXPIRED", "证书已过期"],
])("reports a safe network cause for %s", async (code, hint) => {
  const cause = Object.assign(new Error("private upstream URL and credentials"), { code });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause })));
  const provider = new OpenAIProvider({ apiKey: "sk-test", model: "vision-test" });
  const error = await provider.generate([{ role: "user", content: "hi" }]).catch((error: Error) => error);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain(hint);
  expect((error as Error).message).toContain(code);
  expect((error as Error).message).not.toContain(cause.message);
});

it("finds network codes inside aggregate connection failures", async () => {
  const cause = new AggregateError([Object.assign(new Error("private address"), { code: "ETIMEDOUT" })]);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause })));
  const provider = new OpenAIProvider({ apiKey: "sk-test", model: "vision-test" });
  await expect(provider.generate([{ role: "user", content: "hi" }])).rejects.toThrow("ETIMEDOUT");
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
