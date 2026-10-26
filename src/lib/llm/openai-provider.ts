import type { ChatMessage, GenerateOptions, LLMProvider, ProviderConfig } from "./provider";
import { resolveThinkingParam } from "./thinking";
import { openCodeSessionId } from "./opencode";
import { isTauri, tauriProxyOptions } from "@/lib/platform";
import type { ProxyAgent } from "undici";

/** Normalize the base URL shared by provider requests and model discovery. */
export function normalizeProviderBaseURL(baseURL?: string): string {
  return (baseURL ?? "https://api.openai.com").replace(/\/+$/, "");
}

const NETWORK_ERROR_DETAILS: Record<string, string> = {
  UND_ERR_CONNECT_TIMEOUT: "连接超时，请检查模型服务地址和代理。",
  UND_ERR_HEADERS_TIMEOUT: "等待模型服务响应超时。",
  UND_ERR_BODY_TIMEOUT: "读取模型服务响应超时。",
  UND_ERR_SOCKET: "连接被中断，请检查模型服务或代理是否断开了请求。",
  ECONNRESET: "连接被重置，请检查模型服务或代理是否断开了请求。",
  ECONNREFUSED: "连接被拒绝，请检查模型服务或代理是否正在运行。",
  ETIMEDOUT: "网络连接超时，请检查网络和代理。",
  ENOTFOUND: "无法解析模型服务地址，请检查地址和 DNS。",
  EAI_AGAIN: "域名解析暂时失败，请稍后重试。",
  CERT_HAS_EXPIRED: "服务证书已过期，请检查服务地址和系统时间。",
  DEPTH_ZERO_SELF_SIGNED_CERT: "服务证书不受信任，请检查模型服务或代理的证书配置。",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "无法验证服务证书，请检查模型服务或代理的证书配置。",
};

function networkErrorDetail(error: unknown, depth = 0): string | undefined {
  if (!error || typeof error !== "object" || depth > 4) return undefined;
  const details = error as { code?: unknown; cause?: unknown; errors?: unknown[] };
  if (typeof details.code === "string" && Object.hasOwn(NETWORK_ERROR_DETAILS, details.code)) {
    return `${NETWORK_ERROR_DETAILS[details.code]}（${details.code}）`;
  }
  const causeDetail = networkErrorDetail(details.cause, depth + 1);
  if (causeDetail) return causeDetail;
  if (Array.isArray(details.errors)) {
    for (const nested of details.errors) {
      const detail = networkErrorDetail(nested, depth + 1);
      if (detail) return detail;
    }
  }
  return undefined;
}

/**
 * OpenAI 兼容协议的 provider（DeepSeek、OpenAI、及其他兼容端点通用）。
 * 直接调用 /chat/completions，不依赖 SDK，减少依赖面。
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = "openai-compatible";
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly model: string;
  private readonly sessionId: string | undefined;
  /** 代理 dispatcher；null 表示直连（仅 Node 环境使用） */
  private readonly dispatcher: ProxyAgent | null;
  /** 保留原始 proxy 配置，供 Tauri 分支用 plugin-http 的 proxy 参数 */
  private readonly proxyConfig: ProviderConfig["proxy"];

  constructor(config: ProviderConfig, dispatcher: ProxyAgent | null = null) {
    this.apiKey = config.apiKey;
    this.baseURL = normalizeProviderBaseURL(config.baseURL);
    this.model = config.model;
    this.sessionId = openCodeSessionId(this.baseURL, config.sessionId);
    this.proxyConfig = config.proxy;
    this.dispatcher = dispatcher;
  }

  async generate(
    messages: ChatMessage[],
    options: GenerateOptions = {},
  ): Promise<string> {
    const url = `${this.baseURL}/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.sessionId) headers["x-opencode-session"] = this.sessionId;
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
      if (isTauri()) {
        // Tauri 环境：用 plugin-http（Rust reqwest 发出），绕过 CORS
        const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
        const proxy = await tauriProxyOptions(this.proxyConfig ?? undefined);
        res = await tauriFetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: options.signal,
          ...(proxy ? { proxy } : {}),
        } as RequestInit);
      } else {
        const fetchOpts: RequestInit & { dispatcher?: ProxyAgent } = {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: options.signal,
        };
        if (this.dispatcher) fetchOpts.dispatcher = this.dispatcher;
        res = await fetch(url, fetchOpts);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw err;
      throw new Error(
        `无法连接 LLM 服务：${networkErrorDetail(err) ?? (err instanceof Error ? err.message : String(err))}`,
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
