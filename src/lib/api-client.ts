import { isTauri } from "@/lib/platform";
import type { LLMProvider } from "@/lib/llm/provider";
import { processReviewRequest } from "@/lib/llm/review-core";
import { processChatRequest } from "@/lib/llm/chat-core";
import { processChangeSetRequest } from "@/lib/llm/change-set-core";
import { OpenAIProvider } from "@/lib/llm/openai-provider";

/**
 * 统一 API 调用层。
 *
 * 双轨：
 * - 浏览器版：fetch /api/*（走 Next.js 服务端路由）
 * - Tauri 版：直接调 *-core.ts 纯函数（LLM 逻辑已搬到前端，用 plugin-http 发请求）
 *
 * 这个文件是前端调用 LLM 能力的唯一入口，产品组件不直接 fetch /api/*。
 */

type LLMConfig = {
  apiKey: string;
  baseURL?: string;
  model?: string;
  reasoningEffort?: string;
  proxy?: { type: "http" | "socks5"; host: string; port: number };
};

function makeTauriProvider(llmConfig?: LLMConfig): LLMProvider {
  if (!llmConfig?.apiKey) {
    throw new Error("Tauri 版需要在设置面板配置 API Key。");
  }
  return new OpenAIProvider({
    apiKey: llmConfig.apiKey,
    baseURL: llmConfig.baseURL,
    model: llmConfig.model || "deepseek-chat",
    proxy: llmConfig.proxy,
  });
}

async function fetchApi(path: string, body: unknown, signal?: AbortSignal) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `请求失败（HTTP ${res.status}）`);
  }
  return data;
}

// ─── 审阅 ──────────────────────────────────────────────────────

export async function callReview(body: unknown, signal?: AbortSignal) {
  if (isTauri()) {
    const llmConfig = (body as { llmConfig?: LLMConfig }).llmConfig;
    const provider = makeTauriProvider(llmConfig);
    const result = await processReviewRequest(body, () => provider, { signal });
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  }
  return fetchApi("/api/review", body, signal);
}

// ─── 对话 ──────────────────────────────────────────────────────

export async function callChat(body: unknown, signal?: AbortSignal) {
  if (isTauri()) {
    const llmConfig = (body as { llmConfig?: LLMConfig }).llmConfig;
    const provider = makeTauriProvider(llmConfig);
    const result = await processChatRequest(body, () => provider, { signal });
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  }
  return fetchApi("/api/chat", body, signal);
}

// ─── 修改集 ────────────────────────────────────────────────────

export async function callChangeSet(body: unknown, signal?: AbortSignal) {
  if (isTauri()) {
    const llmConfig = (body as { llmConfig?: LLMConfig }).llmConfig;
    const provider = makeTauriProvider(llmConfig);
    const result = await processChangeSetRequest(body, () => provider, { signal });
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  }
  return fetchApi("/api/change-set", body, signal);
}

// ─── 模型列表 ──────────────────────────────────────────────────

export async function fetchModels(body: unknown, signal?: AbortSignal) {
  if (isTauri()) {
    // Tauri 版：直接用 plugin-http 调 /models
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    const { normalizeModelIds } = await import("@/lib/llm/model-list");
    const { normalizeProviderBaseURL } = await import("@/lib/llm/openai-provider");
    const { tauriProxyOptions } = await import("@/lib/platform");

    const { apiKey, baseURL, proxy } = body as {
      apiKey: string;
      baseURL: string;
      proxy?: { type: "http" | "socks5"; host: string; port: number };
    };
    const proxyOpts = await tauriProxyOptions(proxy);
    const url = `${normalizeProviderBaseURL(baseURL)}/models`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const res = await tauriFetch(url, {
      method: "GET",
      headers,
      signal,
      ...(proxyOpts ? { proxy: proxyOpts } : {}),
    } as RequestInit);
    if (!res.ok) throw new Error(`模型服务返回错误（HTTP ${res.status}）。`);
    const payload = await res.json();
    return { models: normalizeModelIds(payload) };
  }
  return fetchApi("/api/models", body, signal);
}

// ─── 测试连接 ──────────────────────────────────────────────────

export async function testConnection(body: unknown, signal?: AbortSignal) {
  if (isTauri()) {
    const { llmConfig } = body as { llmConfig?: LLMConfig };
    if (!llmConfig?.apiKey) {
      throw new Error("请在设置面板配置 API Key 后再测试连接。");
    }
    const provider = makeTauriProvider(llmConfig);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort);
    try {
      await provider.generate([{ role: "user", content: "hi" }], {
        maxTokens: 64,
        signal: controller.signal,
        reasoningEffort: "off",
      });
      return { ok: true };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  return fetchApi("/api/test-connection", body, signal);
}
