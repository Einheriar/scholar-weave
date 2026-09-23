import {
  LLMReviewResponseSchema,
  ReviewRequestSchema,
  type ReviewRequest,
} from "@/lib/llm/review-llm-schema";
import { ReviewItemSchema, type ReviewItem } from "@/lib/review-schema";
import { locateInText } from "@/lib/anchoring";
import { buildReviewMessages } from "@/lib/llm/prompts";
import { callLLMStructuredCore, type ApiError } from "@/lib/llm/llm-core";
import type { LLMProvider } from "@/lib/llm/provider";

/**
 * /api/review 的纯函数核心——与 Next.js / Tauri 都无关。
 *
 * 负责：规模限制、调 LLM、edit 锚点定位校验、ID 生成、ReviewItemSchema 校验。
 * 输入输出都不含 NextResponse，由调用方自行包装。
 */

const MAX_BLOCKS = 200;
const MAX_TOTAL_CHARS = 60_000;

export type ReviewSuccess = {
  documentSummary: string;
  items: ReviewItem[];
  documentRevision: number;
  checksum: string;
};

export type ReviewResult =
  | { ok: true; data: ReviewSuccess }
  | { ok: false; error: ApiError["error"] };

export async function processReviewRequest(
  rawBody: unknown,
  getProvider: () => LLMProvider,
  opts: { signal?: AbortSignal } = {},
): Promise<ReviewResult> {
  const parsed = ReviewRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "invalid_request",
        message: `请求参数不合法：${parsed.error.issues[0]?.message ?? "未知错误"}`,
      },
    };
  }
  const reqBody: ReviewRequest = parsed.data;

  if (reqBody.blocks.length === 0) {
    return { ok: false, error: { code: "empty_document", message: "文档没有可审阅的段落。" } };
  }
  if (reqBody.blocks.length > MAX_BLOCKS) {
    return {
      ok: false,
      error: { code: "too_many_blocks", message: `段落数超过上限（${MAX_BLOCKS}）。` },
    };
  }
  const totalChars = reqBody.blocks.reduce((n, b) => n + b.text.length, 0);
  if (totalChars > MAX_TOTAL_CHARS) {
    return {
      ok: false,
      error: { code: "too_long", message: `文档总字数超过上限（${MAX_TOTAL_CHARS}）。` },
    };
  }

  // 校验全过后才解析 provider（这样不合法请求不需要 provider 也能返回正确错误码）
  const provider = typeof getProvider === "function" ? getProvider() : getProvider;

  const messages = buildReviewMessages(reqBody);
  const llmResult = await callLLMStructuredCore(
    provider,
    messages,
    LLMReviewResponseSchema,
    { signal: opts.signal, maxTokens: 16000, reasoningEffort: reqBody.llmConfig?.reasoningEffort },
  );
  if (!llmResult.ok) return { ok: false, error: llmResult.error };
  const llmData = llmResult.data;

  const blockTextById = new Map(reqBody.blocks.map((b) => [b.id, b.text]));
  const items: ReviewItem[] = [];

  for (const rawItem of llmData.items) {
    const full = {
      ...rawItem,
      // 不信任 LLM 生成的标识，避免重复 ID 造成前端状态串联。
      id: `review_${crypto.randomUUID()}`,
      status: "open" as const,
      documentRevision: reqBody.revision,
    };
    const validated = ReviewItemSchema.safeParse(full);
    if (!validated.success) continue;
    const item = validated.data;

    // 锚点定位校验：edit 必须能在对应 block 中精确定位
    if (item.kind === "edit" && item.scope.type === "range") {
      const text = blockTextById.get(item.scope.blockId);
      if (text === undefined) continue;
      const hit = locateInText(text, item.scope.original, item.scope.prefix, item.scope.suffix);
      if (!hit.ok) continue; // 无法定位则丢弃，不猜测位置
    }
    if (item.scope.type === "block" && !blockTextById.has(item.scope.blockId)) {
      continue;
    }
    items.push(item);
  }

  return {
    ok: true,
    data: {
      documentSummary: llmData.documentSummary,
      items,
      documentRevision: reqBody.revision,
      checksum: reqBody.checksum,
    },
  };
}
