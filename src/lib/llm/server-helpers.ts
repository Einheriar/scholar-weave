import { NextResponse } from "next/server";
import type { z } from "zod";
import { getProviderFromEnv, getProviderFromUserConfig } from "./provider";
import type { ChatMessage } from "./provider";
import { callLLMStructuredCore, type ApiError } from "./llm-core";

/**
 * 服务端 LLM 端点的共享辅助：provider 获取、超时/取消、JSON 提取、Zod 校验。
 * 供 /api/review、/api/chat、/api/change-set 复用，统一错误结构。
 *
 * 核心逻辑在 llm-core.ts（纯函数），这个文件只是 Next.js 的薄包装。
 */

export type { ApiError };

export function apiError(
  status: number,
  code: string,
  message: string,
): NextResponse<ApiError> {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status });
}

/** re-export 供 route.ts 里已有的 import 不报错 */
export { extractJson } from "./llm-core";

export type CallLLMResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse<ApiError> };

/**
 * Next.js 路由版的 callLLMStructured。
 * 解析 provider、把 llm-core 的错误包成 NextResponse。
 */
export async function callLLMStructured<S extends z.ZodType>(
  request: Request,
  messages: ChatMessage[],
  schema: S,
  opts: {
    timeoutMs?: number;
    maxTokens?: number;
    debugLabel?: string;
    llmConfig?: {
      apiKey: string;
      baseURL?: string;
      model?: string;
      reasoningEffort?: string;
      proxy?: { type: "http" | "socks5"; host: string; port: number };
    };
  } = {},
): Promise<CallLLMResult<z.infer<S>>> {
  let provider;
  try {
    provider = opts.llmConfig?.apiKey
      ? getProviderFromUserConfig(opts.llmConfig)
      : getProviderFromEnv();
  } catch (e) {
    return {
      ok: false,
      response: apiError(
        500,
        "provider_misconfigured",
        e instanceof Error ? e.message : "LLM 服务未配置。",
      ),
    };
  }

  const result = await callLLMStructuredCore(provider, messages, schema, {
    signal: request.signal,
    timeoutMs: opts.timeoutMs,
    maxTokens: opts.maxTokens,
    reasoningEffort: opts.llmConfig?.reasoningEffort,
  });

  if (!result.ok) {
    // 把 error code 映射回 HTTP status（与 llm-core 里的语义保持一致）
    const status =
      result.error.code === "client_aborted"
        ? 499
        : result.error.code === "llm_timeout"
          ? 504
          : result.error.code === "llm_bad_json" || result.error.code === "llm_schema_mismatch"
            ? 502
            : 502;
    return { ok: false, response: apiError(status, result.error.code, result.error.message) };
  }

  return result;
}
