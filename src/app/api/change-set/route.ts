import { NextResponse } from "next/server";
import {
  ChangeSetRequestSchema,
  LLMChangeSetSchema,
} from "@/lib/llm/chat-llm-schema";
import { buildChangeSetMessages } from "@/lib/llm/chat-prompts";
import { apiError, callLLMStructured } from "@/lib/llm/server-helpers";
import { ChangeSetSchema, type ChangeSet, type DocumentState } from "@/lib/review-schema";
import { resolveEdit } from "@/lib/changeset";

/**
 * POST /api/change-set（PLAN 12）。
 * 把一条 opinion（+ 用户补充要求）转化为可执行 ChangeSet，返回待预览形态。
 * 与 /api/chat 分离，便于 MVP 阶段独立测试；若后续 /api/chat 足够可靠可合并。
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_TOTAL_CHARS = 60_000;

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError(400, "bad_json", "请求体不是合法 JSON。");
  }
  const parsed = ChangeSetRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError(
      400,
      "invalid_request",
      `请求参数不合法：${parsed.error.issues[0]?.message ?? "未知错误"}`,
    );
  }
  const body = parsed.data;

  const totalChars = body.blocks.reduce((n, b) => n + b.text.length, 0);
  if (totalChars > MAX_TOTAL_CHARS) {
    return apiError(413, "too_long", `内容总字数超过上限（${MAX_TOTAL_CHARS}）。`);
  }

  const messages = buildChangeSetMessages(body);
  const result = await callLLMStructured(request, messages, LLMChangeSetSchema);
  if (!result.ok) return result.response;

  const doc: DocumentState = {
    id: body.documentId,
    title: "",
    blocks: body.blocks.map((b) => ({ id: b.id, type: "paragraph" as const, text: b.text })),
    revision: body.revision,
    checksum: body.checksum,
    updatedAt: "",
  };
  const edits = result.data.edits
    .map((e) => ({ ...e, status: "pending" as const }))
    .filter((e) => resolveEdit(doc, e).ok);

  if (edits.length === 0) {
    return apiError(
      502,
      "no_applicable_edits",
      "未能生成可定位的修改，请换个说法重试。",
    );
  }

  const changeSet: ChangeSet = {
    id: `cs_${crypto.randomUUID()}`,
    sourceReviewId: body.sourceReview.id,
    documentRevision: body.revision,
    summary: result.data.summary,
    edits,
  };
  const validated = ChangeSetSchema.safeParse(changeSet);
  if (!validated.success) {
    return apiError(502, "llm_schema_mismatch", "修改集结构不合法。");
  }
  return NextResponse.json({ changeSet: validated.data });
}
