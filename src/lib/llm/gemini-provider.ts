import { z } from "zod";
import type { ChatMessage, GenerateOptions, LLMProvider, ProviderConfig } from "./provider";
import type { ProxyAgent } from "undici";
import { isOpenCodeEndpoint, openCodeSessionId } from "./opencode";
import { postProviderJSON } from "./provider-http";

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

const ResponseSchema = z.object({
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  candidates: z.array(z.object({
    finishReason: z.string().optional(),
    content: z.object({
      parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() })).optional(),
    }).optional(),
  })).optional(),
});

function generateURL(baseURL: string | undefined, model: string): URL {
  const url = new URL(baseURL || "https://generativelanguage.googleapis.com/v1beta");
  let path = url.pathname.replace(/\/+$/, "");
  if (isOpenCodeEndpoint(url.href)) {
    const prefix = path.match(/^\/(inference|zen)(?:\/go)?(?=\/|$)/)?.[0];
    if (prefix) path = prefix.startsWith("/inference") ? `${prefix}/google/v1beta` : `${prefix}/v1`;
  } else {
    path = path.replace(/\/models(?:\/.*)?$/, "");
    if (url.hostname === "generativelanguage.googleapis.com") {
      path = path.replace(/\/openai(?:\/.*)?$/, "");
    }
  }
  url.pathname = `${path || "/v1beta"}/models/${encodeURIComponent(model.trim().replace(/^models\//, ""))}:generateContent`;
  url.hash = "";
  return url;
}

function messageParts(message: ChatMessage): GeminiPart[] {
  if (typeof message.content === "string") return message.content ? [{ text: message.content }] : [];
  return message.content.flatMap((part): GeminiPart[] => {
    if (part.type === "text") return part.text ? [{ text: part.text }] : [];
    const image = part.image_url.url.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!image) throw new Error("Gemini 原生接口的图片必须是内嵌的 PNG、JPEG 或 WebP 数据。");
    return [{ inlineData: { mimeType: image[1], data: image[2] } }];
  });
}

function thinkingConfig(model: string, effort?: string): Record<string, unknown> | undefined {
  if (!effort || effort === "auto") return undefined;
  // Modern Gemini can silently map budget zero to a low level, so reject an
  // unsupported off request locally rather than implying thinking was disabled.
  if (effort === "off") {
    if (/gemini-2\.5-flash/i.test(model)) return { thinkingBudget: 0 };
    throw new Error("该 Gemini 模型不支持关闭思考，请选择“默认”或其他思考档位。");
  }
  if (/gemini-2\.5/i.test(model)) {
    const budgets: Record<string, number> = {
      low: 1024,
      high: 8192,
      max: /gemini-2\.5-flash/i.test(model) ? 24576 : 32768,
    };
    if (Object.hasOwn(budgets, effort)) return { thinkingBudget: budgets[effort] };
  }
  return { thinkingLevel: effort === "max" ? "HIGH" : effort.toUpperCase() };
}

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  private readonly url: URL;
  private readonly sessionId: string | undefined;

  constructor(
    private readonly config: ProviderConfig,
    private readonly dispatcher: ProxyAgent | null = null,
  ) {
    this.url = generateURL(config.baseURL, config.model);
    this.sessionId = openCodeSessionId(this.url.href, config.sessionId);
  }

  async generate(messages: ChatMessage[], options: GenerateOptions = {}): Promise<string> {
    const contents: Array<{ role: "user" | "model"; parts: GeminiPart[] }> = [];
    const systemParts: GeminiPart[] = [];
    for (const message of messages) {
      const parts = messageParts(message);
      if (message.role === "system") {
        if (parts.some((part) => !("text" in part))) throw new Error("Gemini 的系统提示仅支持文字。");
        systemParts.push(...parts);
      } else if (parts.length) {
        contents.push({ role: message.role === "assistant" ? "model" : "user", parts });
      }
    }
    const generationConfig: Record<string, unknown> = {};
    if (options.temperature !== undefined) generationConfig.temperature = options.temperature;
    if (options.maxTokens !== undefined) generationConfig.maxOutputTokens = options.maxTokens;
    if (options.jsonMode) generationConfig.responseMimeType = "application/json";
    const thinking = thinkingConfig(this.config.model, options.reasoningEffort);
    if (thinking) generationConfig.thinkingConfig = thinking;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.url.hostname === "generativelanguage.googleapis.com") {
      headers["x-goog-api-key"] = this.config.apiKey;
    } else {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }
    if (this.sessionId) headers["x-opencode-session"] = this.sessionId;
    const payload = await postProviderJSON(this.url.href, {
      contents,
      ...(systemParts.length ? { systemInstruction: { parts: systemParts } } : {}),
      generationConfig,
    }, { headers, signal: options.signal, proxy: this.config.proxy, dispatcher: this.dispatcher });
    const parsed = ResponseSchema.safeParse(payload);
    if (!parsed.success) throw new Error("Gemini 返回的响应数据结构无法识别。");
    const { candidates, promptFeedback } = parsed.data;
    if (promptFeedback?.blockReason && promptFeedback.blockReason !== "BLOCK_REASON_UNSPECIFIED") {
      throw new Error("Gemini 拦截了此次请求，未生成回复。");
    }
    const candidate = candidates?.[0];
    if (candidate?.finishReason === "MAX_TOKENS") {
      throw new Error("Gemini 输出达到长度上限并被截断，请降低思考档位或缩小请求范围后重试。");
    }
    if (candidate?.finishReason === "RECITATION") {
      throw new Error("Gemini 因内容重复限制而停止回复（RECITATION）。");
    }
    if (candidate?.finishReason && candidate.finishReason !== "STOP") {
      throw new Error("Gemini 未正常完成回复，可能受到内容或模型限制。");
    }
    const content = candidate?.content?.parts?.filter((part) => !part.thought && typeof part.text === "string")
      .map((part) => part.text).join("");
    if (!content?.trim()) throw new Error("Gemini 返回了空内容。");
    return content;
  }
}
