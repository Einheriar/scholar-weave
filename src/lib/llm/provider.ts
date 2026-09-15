import { OpenAIProvider } from "./openai-provider";

/**
 * 轻量 LLM provider adapter（PLAN 8.1）。
 * 定义统一接口，第一版接 OpenAI 兼容协议（DeepSeek 端点）。
 * 后续可平滑增加其他供应商或本地模型。
 */

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type GenerateOptions = {
  /** 期望模型返回严格 JSON（对应 OpenAI 的 response_format: json_object） */
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** DeepSeek-style reasoning effort（minimal/low/medium/high/xhigh/max/ultra） */
  reasoningEffort?: string;
};

export interface LLMProvider {
  readonly name: string;
  /** 一次对话补全，返回模型文本输出 */
  generate(messages: ChatMessage[], options?: GenerateOptions): Promise<string>;
}

export type ProviderConfig = {
  apiKey: string;
  baseURL?: string;
  model: string;
};

/** 从环境变量构造当前配置的 provider（密钥只在服务端读取） */
export function getProviderFromEnv(): LLMProvider {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "缺少 OPENAI_API_KEY。请在服务端环境变量（.env.local）中配置。",
    );
  }
  const model = process.env.LLM_MODEL ?? "deepseek-chat";
  const baseURL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com";
  return new OpenAIProvider({ apiKey, baseURL, model });
}

/**
 * 从用户请求体构造 provider（用户设置优先于 env）。
 * 客户端传来的配置只在本次请求内使用，不落盘。
 */
export function getProviderFromUserConfig(config: {
  apiKey: string;
  baseURL?: string;
  model?: string;
}): LLMProvider {
  return new OpenAIProvider({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    model: config.model || "deepseek-chat",
  });
}
