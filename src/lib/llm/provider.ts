import { createProvider } from "./create-provider";
import { buildProxyDispatcher } from "./server-proxy";

/**
 * Shared protocol interface; createProvider selects native Gemini by model name
 * and otherwise uses OpenAI-compatible Chat Completions.
 */

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
};

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type GenerateOptions = {
  /** Request JSON output using the selected provider's native format. */
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /**
   * Abstract thinking effort: auto/off/low/high/max. Each adapter translates it
   * to native parameters and rejects unsupported requests without downgrading.
   */
  reasoningEffort?: string;
};

export interface LLMProvider {
  readonly name: string;
  /** 一次对话补全，返回模型文本输出 */
  generate(messages: ChatMessage[], options?: GenerateOptions): Promise<string>;
}

export type ProxyConfig = {
  type: "http" | "socks5";
  host: string;
  port: number;
};

export type ProviderConfig = {
  apiKey: string;
  baseURL?: string;
  model: string;
  /** 代理；undefined 表示直连 */
  proxy?: ProxyConfig;
  /** Stable conversation identity; never included in model prompts. */
  sessionId?: string;
};

/**
 * 从环境变量构造当前配置的 provider（密钥只在服务端读取）。
 * 代理也支持从环境变量读：HTTPS_PROXY / HTTP_PROXY / SOCKS5_PROXY。
 */
export function getProviderFromEnv(sessionId?: string): LLMProvider {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "缺少 OPENAI_API_KEY。请在服务端环境变量（.env.local）中配置。",
    );
  }
  const model = process.env.LLM_MODEL ?? "deepseek-chat";
  const baseURL = process.env.OPENAI_BASE_URL;
  const proxy = resolveProxyFromEnv();
  return createProvider({ apiKey, baseURL, model, proxy, sessionId }, buildProxyDispatcher(proxy));
}

/**
 * 从用户请求体构造 provider（用户设置优先于 env）。
 * 客户端传来的配置只在本次请求内使用，不落盘。
 */
export function getProviderFromUserConfig(config: {
  apiKey: string;
  baseURL?: string;
  model?: string;
  proxy?: ProxyConfig;
}, sessionId?: string): LLMProvider {
  return createProvider(
    {
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      model: config.model || "deepseek-chat",
      proxy: config.proxy,
      sessionId,
    },
    buildProxyDispatcher(config.proxy),
  );
}

/**
 * 从环境变量解析代理配置。
 * 依次看 SOCKS5_PROXY / HTTPS_PROXY / HTTP_PROXY，有就用。
 */
function resolveProxyFromEnv(): ProxyConfig | undefined {
  const socks5 = process.env.SOCKS5_PROXY;
  if (socks5) return parseProxyUrl(socks5, "socks5");
  const https = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
  if (https) return parseProxyUrl(https, "http");
  return undefined;
}

function parseProxyUrl(url: string, defaultType: "http" | "socks5"): ProxyConfig | undefined {
  try {
    const u = new URL(url);
    const type = u.protocol.replace(":", "") === "socks5" ? "socks5" : defaultType;
    return { type, host: u.hostname, port: parseInt(u.port, 10) };
  } catch {
    return undefined;
  }
}
