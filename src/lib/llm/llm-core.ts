import type { z } from "zod";
import type { ChatMessage, LLMProvider } from "./provider";

/**
 * 纯函数 LLM 调用核心——与 Next.js / Tauri 都无关。
 *
 * callLLMStructured 的纯函数版：超时/取消、JSON 提取、Zod 校验、
 * 首次失败自动纠错一次（规则 28）。不依赖 NextResponse，返回值
 * 由调用方（Next 路由 or Tauri api-client）自行包装。
 */

export type ApiError = { error: { code: string; message: string } };

export type CallLLMResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError["error"] };

type StructuredParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: "llm_bad_json" | "llm_schema_mismatch"; detail: string };

/** 从模型输出中提取 JSON（容忍其包了 markdown 代码块） */
export function extractJson(content: string): string {
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start >= 0 && end > start) return content.slice(start, end + 1);
  return content;
}

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
 * provider 由调用方注入，这样测试可以 mock，Tauri 前端也可以换成 plugin-http 版本。
 */
export async function callLLMStructuredCore<S extends z.ZodType>(
  provider: LLMProvider,
  messages: ChatMessage[],
  schema: S,
  opts: {
    signal?: AbortSignal;
    timeoutMs?: number;
    maxTokens?: number;
    reasoningEffort?: string;
  } = {},
): Promise<CallLLMResult<z.infer<S>>> {
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onExternalAbort);

  let content: string;
  try {
    content = await provider.generate(messages, {
      jsonMode: true,
      signal: controller.signal,
      maxTokens: opts.maxTokens ?? 16000,
      reasoningEffort: opts.reasoningEffort,
    });

    const firstParsed = parseStructuredContent(content, schema);
    if (firstParsed.ok) return firstParsed;

    content = await provider.generate(
      buildRepairMessages(messages, content, firstParsed.detail),
      {
        jsonMode: true,
        signal: controller.signal,
        maxTokens: opts.maxTokens ?? 16000,
        temperature: 0,
        reasoningEffort: opts.reasoningEffort,
      },
    );
    const repaired = parseStructuredContent(content, schema);
    if (repaired.ok) return repaired;
    return {
      ok: false,
      error: {
        code: repaired.code,
        message:
          repaired.code === "llm_bad_json"
            ? "LLM 自动纠错后仍未返回合法 JSON。"
            : "LLM 自动纠错后返回结构仍不符合协议。",
      },
    };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      const externalAborted = opts.signal?.aborted ?? false;
      return {
        ok: false,
        error: {
          code: externalAborted ? "client_aborted" : "llm_timeout",
          message: externalAborted ? "请求已取消。" : "处理超时，请重试。",
        },
      };
    }
    return {
      ok: false,
      error: {
        code: "llm_error",
        message: e instanceof Error ? e.message : "LLM 调用失败。",
      },
    };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onExternalAbort);
  }
}
