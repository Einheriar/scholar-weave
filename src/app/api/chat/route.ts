import { NextResponse } from "next/server";
import {
  ChatRequestSchema,
  LLMChatResponseSchema,
} from "@/lib/llm/chat-llm-schema";
import { buildChatMessages } from "@/lib/llm/chat-prompts";
import { apiError, callLLMStructured } from "@/lib/llm/server-helpers";
import {
  ChangeSetSchema,
  type ChangeSet,
} from "@/lib/review-schema";
import { resolveEdit } from "@/lib/changeset";
import type { DocumentState } from "@/lib/review-schema";

/**
 * POST /api/chat（PLAN 12）。
 * 输入聊天上下文、必要文档片段、关联建议与消息历史；
 * 输出纯解释（answer）或解释 + 待预览修改集（answer_with_changes）。
 * 任何回复都不直接改正文；修改集只返回待预览形态。
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BLOCKS = 200;
const MAX_TOTAL_CHARS = 60_000;
const MAX_HISTORY = 12;

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError(400, "bad_json", "请求体不是合法 JSON。");
  }
  const parsed = ChatRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError(
      400,
      "invalid_request",
      `请求参数不合法：${parsed.error.issues[0]?.message ?? "未知错误"}`,
    );
  }
  const body = parsed.data;

  if (body.blocks.length > MAX_BLOCKS) {
    return apiError(413, "too_many_blocks", `段落数超过上限（${MAX_BLOCKS}）。`);
  }
  const totalChars = body.blocks.reduce((n, b) => n + b.text.length, 0);
  if (totalChars > MAX_TOTAL_CHARS) {
    return apiError(413, "too_long", `内容总字数超过上限（${MAX_TOTAL_CHARS}）。`);
  }
  if (body.history.length > MAX_HISTORY) {
    body.history = body.history.slice(-MAX_HISTORY);
  }

  const messages = buildChatMessages(body);
  const result = await callLLMStructured(request, messages, LLMChatResponseSchema);
  if (!result.ok) return result.response;
  const llm = result.data;

  if (llm.type === "answer") {
    return NextResponse.json({ type: "answer", answer: llm.answer });
  }

  // answer_with_changes：校验每条 edit 能定位，填充 ChangeSet 完整字段
  const doc: DocumentState = {
    id: body.documentId,
    title: "",
    blocks: body.blocks.map((b) => ({ id: b.id, type: "paragraph" as const, text: b.text })),
    revision: body.revision,
    checksum: body.checksum,
    updatedAt: "",
  };
  const edits = llm.changeSet.edits
    .map((e) => ({ ...e, status: "pending" as const }))
    .filter((e) => resolveEdit(doc, e).ok); // 定位不到的修改不进入修改集

  const changeSet: ChangeSet = {
    id: `cs_${crypto.randomUUID()}`,
    documentRevision: body.revision,
    summary: llm.changeSet.summary,
    edits,
  };
  // 再过一次完整 schema 确保合法
  const validated = ChangeSetSchema.safeParse(changeSet);
  if (!validated.success) {
    return apiError(502, "llm_schema_mismatch", "修改集结构不合法。");
  }

  return NextResponse.json({
    type: "answer_with_changes",
    answer: llm.answer,
    changeSet: validated.data,
  });
}
