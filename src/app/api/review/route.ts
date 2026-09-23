import { NextResponse } from "next/server";
import { processReviewRequest } from "@/lib/llm/review-core";
import { getProviderFromEnv, getProviderFromUserConfig } from "@/lib/llm/provider";
import { apiError } from "@/lib/llm/server-helpers";
import { ReviewRequestSchema } from "@/lib/llm/review-llm-schema";

/**
 * POST /api/review（PLAN 12）。
 * 纯逻辑在 src/lib/llm/review-core.ts，这个文件只做：
 * parse JSON → 校验输入 → 解析 provider → 调 core → 包 NextResponse
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

  // 先做完整 safeParse：不合法时直接返回 400，不需要解析 provider
  const preParse = ReviewRequestSchema.safeParse(raw);
  if (!preParse.success) {
    return apiError(
      400,
      "invalid_request",
      `请求参数不合法：${preParse.error.issues[0]?.message ?? "未知错误"}`,
    );
  }

  const llmConfig = preParse.data.llmConfig;

  // lazy provider：core 在校验全过后才调用这个函数
  const getProvider = () =>
    llmConfig?.apiKey
      ? getProviderFromUserConfig(llmConfig)
      : getProviderFromEnv();

  const result = await processReviewRequest(raw, getProvider, { signal: request.signal });
  if (!result.ok) {
    const status =
      result.error.code === "client_aborted"
        ? 499
        : result.error.code === "llm_timeout"
          ? 504
          : result.error.code === "too_many_blocks" || result.error.code === "too_long"
            ? 413
            : result.error.code === "empty_document"
              ? 400
              : result.error.code === "invalid_request"
                ? 400
                : 502;
    return apiError(status, result.error.code, result.error.message);
  }

  return NextResponse.json(result.data);
}
