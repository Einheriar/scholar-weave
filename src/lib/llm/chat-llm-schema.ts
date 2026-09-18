import { z } from "zod";
import {
  ChatContextSchema,
  ReviewCategorySchema,
  ReviewSeveritySchema,
} from "../review-schema";

/**
 * 对话与修改集接口的 wire schema（PLAN 7 / 11 / 12）。
 * LLM 不返回 status / documentRevision，由服务端填充。
 */

/** 对话消息（含历史裁剪后发给模型的记录） */
export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** LLM 产出的可执行编辑（ChangeSet 的组成单元，wire 形态） */
export const LLMConcreteEditSchema = z.object({
  blockId: z.string().min(1),
  original: z.string().min(1),
  replacement: z.string(),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  explanation: z.string(),
});
export type LLMConcreteEdit = z.infer<typeof LLMConcreteEditSchema>;

/** LLM 产出的修改集（wire 形态） */
export const LLMChangeSetSchema = z.object({
  summary: z.string(),
  edits: z.array(LLMConcreteEditSchema),
});
export type LLMChangeSet = z.infer<typeof LLMChangeSetSchema>;

/** 模型提出的候选审阅意见；锚点、kind、状态和 ID 由应用补齐。 */
export const LLMReviewProposalSchema = z.object({
  title: z.string().trim().min(1).max(200),
  explanation: z.string().trim().min(1).max(10_000),
  category: ReviewCategorySchema,
  severity: ReviewSeveritySchema,
});
export type LLMReviewProposal = z.infer<typeof LLMReviewProposalSchema>;

/**
 * 对话回复的三种合法形态（PLAN 7）：
 * - answer：纯解释，不含可执行修改
 * - answer_with_review：解释 + 可由用户转入审阅列表的候选意见
 * - answer_with_changes：解释 + 待预览修改集
 */
export const LLMChatResponseSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("answer"),
    answer: z.string(),
  }),
  z.object({
    type: z.literal("answer_with_review"),
    answer: z.string(),
    reviewProposal: LLMReviewProposalSchema,
  }),
  z.object({
    type: z.literal("answer_with_changes"),
    answer: z.string(),
    changeSet: LLMChangeSetSchema,
  }),
]);
export type LLMChatResponse = z.infer<typeof LLMChatResponseSchema>;

/** 用户 LLM 配置（与审阅共用形态；优先于服务端 env） */
const UserLLMConfigSchema = z
  .object({
    apiKey: z.string().min(1),
    baseURL: z.string().optional(),
    model: z.string().optional(),
    reasoningEffort: z.string().optional(),
    proxy: z
      .object({
        type: z.enum(["http", "socks5"]),
        host: z.string().min(1),
        port: z.number().int().positive().lt(65536),
      })
      .optional(),
  })
  .optional();

/** POST /api/chat 请求 */
export const ChatRequestSchema = z.object({
  documentId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  checksum: z.string(),
  context: ChatContextSchema,
  /** 当前消息 */
  message: z.string().min(1),
  /** 对话历史（已裁剪） */
  history: z.array(ChatMessageSchema).default([]),
  /** 必要文档片段：按上下文打包后的段落 */
  blocks: z.array(z.object({ id: z.string().min(1), text: z.string() })),
  /** 是否由用户明确授权把整篇最新正文作为本轮上下文与可修改范围 */
  includeFullDocument: z.boolean().default(false),
  /** 用户 LLM 配置（优先于服务端 env） */
  llmConfig: UserLLMConfigSchema,
  /** 上下文关联的建议（context.type === "review" 时） */
  reviewItem: z
    .object({
      id: z.string(),
      title: z.string(),
      explanation: z.string(),
      category: ReviewCategorySchema,
    })
    .optional(),
  /**
   * 锚点所在段落内未处理的审阅建议（规则 24：节点边界即上下文边界，
   * 只带锚点段的 open 建议，跨段落不带）。纯上下文供给，不影响修改集协议。
   */
  openReviews: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        explanation: z.string(),
        category: ReviewCategorySchema,
      }),
    )
    .default([]),
  language: z.enum(["zh", "en"]).default("zh"),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

/** POST /api/change-set 请求：把一条 opinion 转为可执行修改集 */
export const ChangeSetRequestSchema = z.object({
  documentId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  checksum: z.string(),
  /** 源意见（opinion） */
  sourceReview: z.object({
    id: z.string(),
    title: z.string(),
    explanation: z.string(),
    category: ReviewCategorySchema,
    scope: z.object({
      type: z.enum(["document", "block", "range"]),
      blockId: z.string().optional(),
    }),
  }),
  /** 用户补充要求，如“保持术语不变”“更保守” */
  instruction: z.string().optional(),
  blocks: z.array(z.object({ id: z.string().min(1), text: z.string() })),
  language: z.enum(["zh", "en"]).default("zh"),
  /** 用户 LLM 配置（优先于服务端 env） */
  llmConfig: UserLLMConfigSchema,
});
export type ChangeSetRequest = z.infer<typeof ChangeSetRequestSchema>;
