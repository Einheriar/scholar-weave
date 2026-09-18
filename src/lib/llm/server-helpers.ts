import { NextResponse } from "next/server";
import type { z } from "zod";
import { getProviderFromEnv, getProviderFromUserConfig } from "./provider";
import type { ChatMessage } from "./provider";

/**
 * 服务端 LLM 端点的共享辅助：provider 获取、超时/取消、JSON 提取、Zod 校验。
 * 供 /api/review、/api/chat、/api/change-set 复用，统一错误结构。
 */

export type ApiError = { error: { code: string; message: string } };

export function apiError(
  status: number,
  code: string,
  message: string,
): NextResponse<ApiError> {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status });
}

/** 从模型输出中提取 JSON（容忍其包了 markdown 代码块） */
export function extractJson(content: string): string {
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start >= 0 && end > start) return content.slice(start, end + 1);
  return content;
}

export type CallLLMResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse<ApiError> };

type StructuredParseResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: "llm_bad_json" | "llm_schema_mismatch";
      detail: string;
    };

function parseStructuredContent<S extends z.ZodType>(
  content: string,
  schema: S,
): StructuredParseResult<z.infer<S>> {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(content));
  } catch {
    return {
      ok: false,
      code: "llm_bad_json",
      detail: "The output is not valid parseable JSON.",
    };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 6)
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "root object";
        return `${path}: ${issue.message}`;
      })
      .join("; ");
    return {
      ok: false,
      code: "llm_schema_mismatch",
      detail: detail || "The output fields do not conform to the protocol.",
    };
  }
  return { ok: true, data: parsed.data };
}

function buildRepairMessages(
  messages: ChatMessage[],
  invalidContent: string,
  detail: string,
): ChatMessage[] {
  return [
    ...messages,
    // 防止异常供应商返回超长垃圾文本，让纠错请求本身无限膨胀。
    { role: "assistant", content: invalidContent.slice(0, 20_000) },
    {
      role: "user",
      content:
        `The previous response failed structured validation: ${detail}\n` +
        "Correct only the JSON syntax and field structure. Do not change the original judgments, suggestions, or edit content. " +
        "Follow the output protocol in the original system message exactly. Output one JSON object only, with no code fences or explanation.",
    },
  ];
}

/**
 * 调用 LLM 并解析/校验结构化输出。
 * 负责超时、客户端取消、JSON 提取、Zod 校验，返回统一错误。
 * 首次仅在 JSON / Schema 错误时自动纠错一次；网络、超时和供应商错误不重试。
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

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onClientAbort = () => controller.abort();
  request.signal.addEventListener("abort", onClientAbort);

  let content: string;
  try {
    content = await provider.generate(messages, {
      jsonMode: true,
      signal: controller.signal,
      maxTokens: opts.maxTokens ?? 16000,
      reasoningEffort: opts.llmConfig?.reasoningEffort,
    });
    if (opts.debugLabel && process.env.DEBUG_REVIEW === "1") {
      console.log(`[${opts.debugLabel}] raw content length:`, content.length);
      console.log(`[${opts.debugLabel}] raw head:`, content.slice(0, 500));
      console.log(
        `[${opts.debugLabel}] extracted head:`,
        extractJson(content).slice(0, 500),
      );
    }

    const firstParsed = parseStructuredContent(content, schema);
    if (firstParsed.ok) return firstParsed;
    if (opts.debugLabel && process.env.DEBUG_REVIEW === "1") {
      console.log(`[${opts.debugLabel}] structured parse error:`, firstParsed.detail);
    }

    content = await provider.generate(
      buildRepairMessages(messages, content, firstParsed.detail),
      {
        jsonMode: true,
        signal: controller.signal,
        maxTokens: opts.maxTokens ?? 16000,
        temperature: 0,
        reasoningEffort: opts.llmConfig?.reasoningEffort,
      },
    );
    const repaired = parseStructuredContent(content, schema);
    if (repaired.ok) return repaired;
    return {
      ok: false,
      response: apiError(
        502,
        repaired.code,
        repaired.code === "llm_bad_json"
          ? "LLM 自动纠错后仍未返回合法 JSON。"
          : "LLM 自动纠错后返回结构仍不符合协议。",
      ),
    };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      const clientAborted = request.signal.aborted;
      return {
        ok: false,
        response: apiError(
          clientAborted ? 499 : 504,
          clientAborted ? "client_aborted" : "llm_timeout",
          clientAborted ? "请求已取消。" : "处理超时，请重试。",
        ),
      };
    }
    return {
      ok: false,
      response: apiError(
        502,
        "llm_error",
        e instanceof Error ? e.message : "LLM 调用失败。",
      ),
    };
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", onClientAbort);
  }
}
