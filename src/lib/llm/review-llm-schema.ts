import { z } from "zod";
import {
  ReviewCategorySchema,
  ReviewScopeSchema,
} from "../review-schema";

/**
 * LLM 审阅接口的 wire schema（PLAN 11.2）。
 *
 * 与 ReviewItem 的差异：LLM 不返回 status / documentRevision——
 * 这两个由服务端在解析后统一填充（status=open，documentRevision 取请求时的版本）。
 * 服务端用本 schema 校验模型输出，再转成带完整字段的 ReviewItem 返回给浏览器。
 */

export const LLMReviewItemSchema = z.object({
  id: z.string().min(1),
  scope: ReviewScopeSchema,
  kind: z.enum(["opinion", "edit"]),
  category: ReviewCategorySchema,
  severity: z.enum(["info", "suggestion", "important"]),
  title: z.string(),
  explanation: z.string(),
  replacement: z.string().optional(),
});
export type LLMReviewItem = z.infer<typeof LLMReviewItemSchema>;

export const LLMReviewResponseSchema = z.object({
  documentSummary: z.string(),
  items: z.array(LLMReviewItemSchema),
});
export type LLMReviewResponse = z.infer<typeof LLMReviewResponseSchema>;

/** 审阅模式（PLAN 5.1：仅纠错 / 适度润色 / 深度审阅） */
export const ReviewModeSchema = z.enum(["proofread", "polish", "deep_review"]);
export type ReviewMode = z.infer<typeof ReviewModeSchema>;

/** 审阅请求（POST /api/review） */
export const ReviewRequestSchema = z.object({
  documentId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  checksum: z.string(),
  mode: ReviewModeSchema,
  /** 原文语言与期望输出语言，例如 zh / en */
  language: z.enum(["zh", "en"]).default("zh"),
  /** 期望的写作风格，如 学术 / 正式 / 简洁（自由文本，可空） */
  style: z.string().optional(),
  /** 必须保留、不得改动的术语或文本 */
  preserveTerms: z.array(z.string()).default([]),
  /** 用户自定义提示词（追加到系统提示末尾） */
  customPrompt: z.string().optional(),
  /** 用户 LLM 配置（优先于服务端 env） */
  llmConfig: z
    .object({
      apiKey: z.string().min(1),
      baseURL: z.string().optional(),
      model: z.string().optional(),
      reasoningEffort: z.string().optional(),
      /** 该预设的代理；enabled=false 或未提供时直连 */
      proxy: z
        .object({
          type: z.enum(["http", "socks5"]),
          host: z.string().min(1),
          port: z.number().int().positive().lt(65536),
        })
        .optional(),
    })
    .optional(),
  /** 带稳定 ID 的段落列表 */
  blocks: z.array(
    z.object({
      id: z.string().min(1),
      text: z.string(),
    }),
  ),
});
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;
