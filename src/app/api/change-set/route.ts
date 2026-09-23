import { NextResponse } from "next/server";
import { processChangeSetRequest } from "@/lib/llm/change-set-core";
import { getProviderFromEnv, getProviderFromUserConfig } from "@/lib/llm/provider";
import { apiError } from "@/lib/llm/server-helpers";
import { ChangeSetRequestSchema } from "@/lib/llm/chat-llm-schema";

/**
 * POST /api/change-set（PLAN 12）。
 * 纯逻辑在 src/lib/llm/change-set-core.ts。
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError(400, "bad_json", "请求体不是合法 JSON。");
  }

  const preParse = ChangeSetRequestSchema.safeParse(raw);
  if (!preParse.success) {
    return apiError(
      400,
      "invalid_request",
      `请求参数不合法：${preParse.error.issues[0]?.message ?? "未知错误"}`,
    );
  }

  const llmConfig = preParse.data.llmConfig;

  const getProvider = () =>
    llmConfig?.apiKey
      ? getProviderFromUserConfig(llmConfig)
      : getProviderFromEnv();

  const result = await processChangeSetRequest(raw, getProvider, { signal: request.signal });
  if (!result.ok) {
    const status =
      result.error.code === "client_aborted"
        ? 499
        : result.error.code === "llm_timeout"
          ? 504
          : result.error.code === "too_long"
            ? 413
            : result.error.code === "invalid_request"
              ? 400
              : 502;
    return apiError(status, result.error.code, result.error.message);
  }

  return NextResponse.json(result.data);
}
