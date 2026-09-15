import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveThinkingParam } from "@/lib/llm/thinking";
import { OpenAIProvider } from "@/lib/llm/openai-provider";

/**
 * 思考档位到请求参数的映射（协议层），以及 provider 是否真的按映射
 * 构造了 HTTP 请求体——settings.ts 里的档位枚举只有接上这一步才算
 * 端到端成立。
 */

describe("resolveThinkingParam", () => {
  it("auto 不传参", () => {
    expect(resolveThinkingParam("auto")).toBeUndefined();
  });
  it("空值不传参", () => {
    expect(resolveThinkingParam(undefined)).toBeUndefined();
    expect(resolveThinkingParam("")).toBeUndefined();
  });
  it("off 映射为 enable_thinking=false", () => {
    expect(resolveThinkingParam("off")).toEqual({ enable_thinking: false });
  });
  it("low/high/max 原样透传", () => {
    expect(resolveThinkingParam("low")).toBe("low");
    expect(resolveThinkingParam("high")).toBe("high");
    expect(resolveThinkingParam("max")).toBe("max");
  });
  it("未知档位原样透传，由端点决定接受或报错", () => {
    expect(resolveThinkingParam("xhigh")).toBe("xhigh");
  });
});

describe("OpenAIProvider 的思考档位请求体", () => {
  const fetchMock = vi.fn();

  function bodyOfLastCall(): Record<string, unknown> {
    const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    return JSON.parse(String(init.body));
  }

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const call = (reasoningEffort?: string) =>
    new OpenAIProvider({
      apiKey: "sk-test",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-chat",
    }).generate([{ role: "user", content: "hi" }], { reasoningEffort });

  it("auto 两个参数都不传", async () => {
    await call("auto");
    const body = bodyOfLastCall();
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body).not.toHaveProperty("enable_thinking");
  });

  it("未传档位时也不带思考参数", async () => {
    await call(undefined);
    const body = bodyOfLastCall();
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body).not.toHaveProperty("enable_thinking");
  });

  it("off 传 enable_thinking=false，不带 reasoning_effort", async () => {
    await call("off");
    const body = bodyOfLastCall();
    expect(body.enable_thinking).toBe(false);
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it.each(["low", "high", "max"] as const)("%s 原样透传", async (effort) => {
    await call(effort);
    expect(bodyOfLastCall().reasoning_effort).toBe(effort);
  });

  it("其余请求字段不受影响", async () => {
    await call("high");
    const body = bodyOfLastCall();
    expect(body.model).toBe("deepseek-chat");
    expect(body.temperature).toBe(0.2);
  });
});
