import {
  ChatRequestSchema,
  LLMChatResponseSchema,
  type ChatRequest,
} from "@/lib/llm/chat-llm-schema";
import { buildChatMessages } from "@/lib/llm/chat-prompts";
import {
  ChatReviewProposalSchema,
  ChangeSetSchema,
  getChatImageDecodedBytes,
  type ChangeSet,
  type DocumentState,
} from "@/lib/review-schema";
import { resolveEdit } from "@/lib/changeset";
import { callLLMStructuredCore, type ApiError } from "@/lib/llm/llm-core";
import type { LLMProvider } from "@/lib/llm/provider";

/**
 * /api/chat 的纯函数核心——与 Next.js / Tauri 都无关。
 */

const MAX_BLOCKS = 200;
const MAX_TOTAL_CHARS = 60_000;
const MAX_HISTORY = 12;
const MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024;

export type ChatSuccess =
  | { type: "answer"; answer: string }
  | { type: "answer_with_review"; answer: string; reviewProposal: unknown }
  | { type: "answer_with_changes"; answer: string; changeSet: ChangeSet };

export type ChatResult =
  | { ok: true; data: ChatSuccess }
  | { ok: false; error: ApiError["error"] };

/**
 * Keep executable edits inside the range the user authorized for this turn.
 */
function isEditInAuthorizedScope(
  blockId: string,
  context: ChatRequest["context"],
  includeFullDocument: boolean,
): boolean {
  if (includeFullDocument || context.type === "document") return true;
  if (context.type === "range" || context.type === "block") {
    return Boolean(context.blockId && context.blockId === blockId);
  }
  if (context.type === "review" && context.blockId) {
    return context.blockId === blockId;
  }
  return true;
}

export async function processChatRequest(
  rawBody: unknown,
  getProvider: () => LLMProvider,
  opts: { signal?: AbortSignal } = {},
): Promise<ChatResult> {
  const parsed = ChatRequestSchema.safeParse(rawBody);
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

  if (
    body.imageInputEnabled === false &&
    (body.images?.length || body.history.some((turn) => turn.images?.length))
  ) {
    return {
      ok: false,
      error: {
        code: "image_input_disabled",
        message: "当前模型配置已关闭图片输入，请在设置中开启后再发送含图片的讨论。",
      },
    };
  }
  if (body.blocks.length > MAX_BLOCKS) {
    return {
      ok: false,
      error: { code: "too_many_blocks", message: `段落数超过上限（${MAX_BLOCKS}）。` },
    };
  }
  const totalChars = body.blocks.reduce((n, b) => n + b.text.length, 0);
  if (totalChars > MAX_TOTAL_CHARS) {
    return {
      ok: false,
      error: { code: "too_long", message: `内容总字数超过上限（${MAX_TOTAL_CHARS}）。` },
    };
  }
  if (body.history.length > MAX_HISTORY) {
    body.history = body.history.slice(-MAX_HISTORY);
  }
  const totalImageBytes = [
    ...(body.images ?? []),
    ...body.history.flatMap((turn) => turn.images ?? []),
  ].reduce((total, image) => total + getChatImageDecodedBytes(image.dataUrl), 0);
  if (totalImageBytes > MAX_TOTAL_IMAGE_BYTES) {
    return {
      ok: false,
      error: {
        code: "too_many_images",
        message: `图片总大小超过上限（${MAX_TOTAL_IMAGE_BYTES}B）。`,
      },
    };
  }

  // 校验全过后才解析 provider
  const provider = typeof getProvider === "function" ? getProvider() : getProvider;

  const messages = buildChatMessages(body);
  const result = await callLLMStructuredCore(provider, messages, LLMChatResponseSchema, {
    signal: opts.signal,
    reasoningEffort: body.llmConfig?.reasoningEffort,
  });
  if (!result.ok) return { ok: false, error: result.error };
  const llm = result.data;

  if (body.anchorStale || llm.type === "answer") {
    return { ok: true, data: { type: "answer", answer: llm.answer } };
  }

  if (llm.type === "answer_with_review") {
    const proposal = ChatReviewProposalSchema.safeParse({
      ...llm.reviewProposal,
      id: `proposal_${crypto.randomUUID()}`,
    });
    if (!proposal.success) {
      return {
        ok: false,
        error: { code: "llm_schema_mismatch", message: "候选审阅意见结构不合法。" },
      };
    }
    return {
      ok: true,
      data: { type: "answer_with_review", answer: llm.answer, reviewProposal: proposal.data },
    };
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
    .filter((e) => isEditInAuthorizedScope(e.blockId, body.context, body.includeFullDocument))
    .map((e) => ({
      ...e,
      id: `edit_${crypto.randomUUID()}`,
      status: "pending" as const,
    }))
    .filter((e) => resolveEdit(doc, e).ok);

  const changeSet: ChangeSet = {
    id: `cs_${crypto.randomUUID()}`,
    documentRevision: body.revision,
    summary: llm.changeSet.summary,
    edits,
  };
  const validated = ChangeSetSchema.safeParse(changeSet);
  if (!validated.success) {
    return {
      ok: false,
      error: { code: "llm_schema_mismatch", message: "修改集结构不合法。" },
    };
  }

  return {
    ok: true,
    data: { type: "answer_with_changes", answer: llm.answer, changeSet: validated.data },
  };
}
