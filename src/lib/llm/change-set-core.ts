import {
  ChangeSetRequestSchema,
  LLMChangeSetSchema,
} from "@/lib/llm/chat-llm-schema";
import { buildChangeSetMessages } from "@/lib/llm/chat-prompts";
import { ChangeSetSchema, type ChangeSet, type DocumentState } from "@/lib/review-schema";
import { resolveEdit } from "@/lib/changeset";
import { callLLMStructuredCore, type ApiError } from "@/lib/llm/llm-core";
import type { LLMProvider } from "@/lib/llm/provider";

/**
 * /api/change-set 的纯函数核心——与 Next.js / Tauri 都无关。
 * 把一条 opinion（+ 用户补充要求）转化为可执行 ChangeSet。
 */

const MAX_TOTAL_CHARS = 60_000;

export type ChangeSetSuccess = { changeSet: ChangeSet };

export type ChangeSetResult =
  | { ok: true; data: ChangeSetSuccess }
  | { ok: false; error: ApiError["error"] };

export async function processChangeSetRequest(
  rawBody: unknown,
  getProvider: () => LLMProvider,
  opts: { signal?: AbortSignal } = {},
): Promise<ChangeSetResult> {
  const parsed = ChangeSetRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "invalid_request",
        message: `请求参数不合法：${parsed.error.issues[0]?.message ?? "未知错误"}`,
      },
    };
  }
  const body = parsed.data;

  const totalChars = body.blocks.reduce((n, b) => n + b.text.length, 0);
  if (totalChars > MAX_TOTAL_CHARS) {
    return {
      ok: false,
      error: { code: "too_long", message: `文档总字数超过上限（${MAX_TOTAL_CHARS}）。` },
    };
  }

  // 校验全过后才解析 provider
  const provider = typeof getProvider === "function" ? getProvider() : getProvider;

  const messages = buildChangeSetMessages(body);
  const result = await callLLMStructuredCore(provider, messages, LLMChangeSetSchema, {
    signal: opts.signal,
    reasoningEffort: body.llmConfig?.reasoningEffort,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const doc: DocumentState = {
    id: body.documentId,
    title: "",
    blocks: body.blocks.map((b) => ({ id: b.id, type: "paragraph" as const, text: b.text })),
    revision: body.revision,
    checksum: body.checksum,
    updatedAt: "",
  };
  const edits = result.data.edits
    .map((e) => ({
      ...e,
      id: `edit_${crypto.randomUUID()}`,
      status: "pending" as const,
    }))
    .filter((e) => resolveEdit(doc, e).ok);

  if (edits.length === 0) {
    return {
      ok: false,
      error: { code: "no_applicable_edits", message: "未能生成可定位的修改，请换个说法重试。" },
    };
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
    return {
      ok: false,
      error: { code: "llm_schema_mismatch", message: "修改集结构不合法。" },
    };
  }
  return { ok: true, data: { changeSet: validated.data } };
}
