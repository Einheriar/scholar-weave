import { z } from "zod";

/**
 * 文档数据模型（PLAN 第 9 节）。
 * Zod schema 是运行时协议的唯一来源，TypeScript 类型由 schema 推导。
 */

export const DocumentBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("paragraph"),
  text: z.string(),
});
export type DocumentBlock = z.infer<typeof DocumentBlockSchema>;

export const DocumentStateSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  blocks: z.array(DocumentBlockSchema),
  /** 每次内容变化递增，用于异步响应的版本校验 */
  revision: z.number().int().nonnegative(),
  /** 正文内容校验和，配合 revision 判断文本是否已变化 */
  checksum: z.string(),
  updatedAt: z.string(),
});
export type DocumentState = z.infer<typeof DocumentStateSchema>;

/** 建议作用范围（PLAN 3.1） */
export const ReviewScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("document") }),
  z.object({ type: z.literal("block"), blockId: z.string().min(1) }),
  z.object({
    type: z.literal("range"),
    blockId: z.string().min(1),
    /** 必须逐字存在于原文中的目标文本 */
    original: z.string().min(1),
    /** 消歧上下文（可选） */
    prefix: z.string().optional(),
    suffix: z.string().optional(),
  }),
]);
export type ReviewScope = z.infer<typeof ReviewScopeSchema>;

export const ReviewCategorySchema = z.enum([
  "grammar",
  "clarity",
  "style",
  "structure",
  "logic",
  "consistency",
]);
export type ReviewCategory = z.infer<typeof ReviewCategorySchema>;

export const ReviewStatusSchema = z.enum([
  "open",
  "accepted",
  "rejected",
  "stale",
]);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

/**
 * 一条审阅建议。严格区分两类（PLAN 3.2）：
 * - opinion：审阅意见/模型判断，不能直接替换正文，不得带 replacement
 * - edit：具体修改，必须带 replacement，且 scope 必须是 range 或 block
 */
export const ReviewItemSchema = z
  .object({
    id: z.string().min(1),
    documentRevision: z.number().int().nonnegative(),
    scope: ReviewScopeSchema,
    kind: z.enum(["opinion", "edit"]),
    category: ReviewCategorySchema,
    severity: z.enum(["info", "suggestion", "important"]),
    title: z.string(),
    explanation: z.string(),
    replacement: z.string().optional(),
    status: ReviewStatusSchema,
  })
  .superRefine((item, ctx) => {
    if (item.kind === "opinion" && item.replacement !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "opinion 不得包含可直接执行的 replacement",
        path: ["replacement"],
      });
    }
    if (item.kind === "edit") {
      if (item.replacement === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "edit 必须包含 replacement",
          path: ["replacement"],
        });
      }
      if (item.scope.type === "document") {
        ctx.addIssue({
          code: "custom",
          message:
            "edit 的 scope 不能是 document；全文结构调整必须走 ChangeSet 差异预览",
          path: ["scope"],
        });
      }
    }
  });
export type ReviewItem = z.infer<typeof ReviewItemSchema>;

/** 一条可执行的具体修改（ChangeSet 的组成单元） */
export const ConcreteEditSchema = z.object({
  id: z.string().min(1),
  blockId: z.string().min(1),
  original: z.string().min(1),
  replacement: z.string(),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  explanation: z.string(),
  status: z.enum(["pending", "accepted", "rejected", "stale"]),
});
export type ConcreteEdit = z.infer<typeof ConcreteEditSchema>;

/** 修改集：一次对话或一条高层意见产生的一组具体修改（PLAN 3.3） */
export const ChangeSetSchema = z.object({
  id: z.string().min(1),
  sourceReviewId: z.string().optional(),
  documentRevision: z.number().int().nonnegative(),
  summary: z.string(),
  edits: z.array(ConcreteEditSchema),
});
export type ChangeSet = z.infer<typeof ChangeSetSchema>;

/** 对话上下文（PLAN 7） */
export const ChatContextSchema = z.object({
  type: z.enum(["document", "block", "range", "review"]),
  blockId: z.string().optional(),
  reviewId: z.string().optional(),
  selectedText: z.string().optional(),
});
export type ChatContext = z.infer<typeof ChatContextSchema>;
