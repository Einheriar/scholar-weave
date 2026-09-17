import { NextResponse } from "next/server";
import { buildReviewMessages } from "@/lib/llm/prompts";
import {
  LLMReviewResponseSchema,
  ReviewRequestSchema,
} from "@/lib/llm/review-llm-schema";
import { ReviewItemSchema, type ReviewItem } from "@/lib/review-schema";
import { locateInText } from "@/lib/anchoring";
import { callLLMStructured } from "@/lib/llm/server-helpers";

/**
 * POST /api/review（PLAN 12）。
 * 输入文档版本、段落与审阅设置；输出结构化 ReviewItem[]。
 *
 * 服务端职责：
 * - Zod 校验输入；限制输入规模；
 * - 调用 LLM 并设置超时/可被取消；
 * - Zod 再校验模型输出；
 * - 过滤无法精确定位的 edit（锚点必须命中，否则丢弃而不是乱替换）；
 * - 填充 status / documentRevision；统一错误结构；不泄露密钥与内部细节。
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 输入规模与 LLM 调用约束
const MAX_BLOCKS = 200;
const MAX_TOTAL_CHARS = 60_000;

type ErrorBody = { error: { code: string; message: string } };

function err(status: number, code: string, message: string) {
  return NextResponse.json<ErrorBody>({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return err(400, "bad_json", "请求体不是合法 JSON。");
  }

  const parsed = ReviewRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return err(
      400,
      "invalid_request",
      `请求参数不合法：${parsed.error.issues[0]?.message ?? "未知错误"}`,
    );
  }
  const reqBody = parsed.data;

  // 输入规模限制
  if (reqBody.blocks.length === 0) {
    return err(400, "empty_document", "文档没有可审阅的段落。");
  }
  if (reqBody.blocks.length > MAX_BLOCKS) {
    return err(413, "too_many_blocks", `段落数超过上限（${MAX_BLOCKS}）。`);
  }
  const totalChars = reqBody.blocks.reduce((n, b) => n + b.text.length, 0);
  if (totalChars > MAX_TOTAL_CHARS) {
    return err(413, "too_long", `文档总字数超过上限（${MAX_TOTAL_CHARS}）。`);
  }

  const messages = buildReviewMessages(reqBody);
  const llmResult = await callLLMStructured(
    request,
    messages,
    LLMReviewResponseSchema,
    { llmConfig: reqBody.llmConfig, debugLabel: "review" },
  );
  if (!llmResult.ok) return llmResult.response;
  const llmData = llmResult.data;

  // 转成完整 ReviewItem：填充 status / documentRevision，过滤无效与不可定位的 edit
  const blockTextById = new Map(reqBody.blocks.map((b) => [b.id, b.text]));
  const items: ReviewItem[] = [];

  for (const rawItem of llmData.items) {
    // 业务校验：edit 的 scope 不能是 document；opinion 不得带 replacement
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

    // 锚点定位校验（PLAN 10.3）：edit 必须能在对应 block 中精确定位
    if (item.kind === "edit" && item.scope.type === "range") {
      const text = blockTextById.get(item.scope.blockId);
      if (text === undefined) continue; // 引用了不存在的 block
      const hit = locateInText(
        text,
        item.scope.original,
        item.scope.prefix,
        item.scope.suffix,
      );
      if (!hit.ok) continue; // 无法定位则丢弃，不猜测位置
    }
    if (item.scope.type === "block" && !blockTextById.has(item.scope.blockId)) {
      continue;
    }
    items.push(item);
  }

  return NextResponse.json({
    documentSummary: llmData.documentSummary,
    items,
    documentRevision: reqBody.revision,
    checksum: reqBody.checksum,
  });
}
