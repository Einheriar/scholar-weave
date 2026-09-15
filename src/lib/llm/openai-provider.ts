import type { ChatMessage, GenerateOptions, LLMProvider, ProviderConfig } from "./provider";
import { resolveThinkingParam } from "./thinking";

/**
 * OpenAI 兼容协议的 provider（DeepSeek、OpenAI、及其他兼容端点通用）。
 * 直接调用 /chat/completions，不依赖 SDK，减少依赖面。
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = "openai-compatible";
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly model: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseURL = (config.baseURL ?? "https://api.openai.com").replace(/\/$/, "");
    this.model = config.model;
  }

  async generate(
    messages: ChatMessage[],
    options: GenerateOptions = {},
  ): Promise<string> {
    const url = `${this.baseURL}/chat/completions`;
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: options.temperature ?? 0.2,
    };
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
    if (options.jsonMode) body.response_format = { type: "json_object" };
    // 思考档位（映射规则见 resolveThinkingParam）：auto 不传参；off 传
    // enable_thinking=false（DeepSeek 风格端点）；不支持的端点会返回 400，
    // 把错误暴露给用户而不是静默忽略。
    const thinking = resolveThinkingParam(options.reasoningEffort);
    if (typeof thinking === "string") body.reasoning_effort = thinking;
    else if (thinking) body.enable_thinking = thinking.enable_thinking;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: options.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw err;
      throw new Error(
        `无法连接 LLM 服务：${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!res.ok) {
      // 不向上游泄露密钥或内部细节，只返回安全的错误摘要
      const text = await res.text().catch(() => "");
      throw new Error(
        `LLM 服务返回错误（HTTP ${res.status}）${text ? `：${text.slice(0, 200)}` : ""}`,
      );
    }

    const rawText = await res.text();
    let data: {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    };
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error(`LLM 返回了非 JSON 响应（HTTP ${res.status}）：${rawText.slice(0, 200)}`);
    }
    const choice = data.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      // 推理模型可能把 token 预算耗在 reasoning 上导致 content 为空
      const reason =
        choice?.finish_reason === "length"
          ? "（输出被 token 上限截断，请增大 maxTokens）"
          : "";
      throw new Error(`LLM 返回了空内容${reason}。`);
    }
    return content;
  }
}
