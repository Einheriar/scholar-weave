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

/**
 * 一轮对话（用户提问或模型回复）。
 * assistant 轮可以挂一个修改集，点击可重新打开预览——正文不会被隐式修改，
 * 修改集里定位不到的条目由 ChangeSetPreview 在渲染时判定为不可应用。
 */
export const ChatTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  changeSet: ChangeSetSchema.optional(),
});
export type ChatTurn = z.infer<typeof ChatTurnSchema>;

/**
 * 一条对话记录（v2 旧模型，仅作迁移期读取旧数据的临时结构，迁完即弃）。
 * 项目制（见 ProjectSchema）取代它成为左侧历史列表的单位。
 */
export const ConversationSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  turns: z.array(ChatTurnSchema),
  /** 对话产生时所在的文档 id，仅作记录，列表不按它过滤 */
  documentId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

/**
 * 聊天节点：一次提问锚定的上下文 + 该节点下的线性往返对话（项目制聊天）。
 * anchor 复用 ChatContext 四种（document / block / range / review）；
 * originalText 是建档时的原文快照——锚点失效（原文被改/删）后对话仍可读、
 * 可继续提问，正文内的锚点标记则消失。
 */
export const ChatNodeSchema = z.object({
  id: z.string().min(1),
  anchor: ChatContextSchema,
  originalText: z.string(),
  createdAt: z.string(),
  turns: z.array(ChatTurnSchema),
});
export type ChatNode = z.infer<typeof ChatNodeSchema>;

/**
 * 项目：一篇文章的完整工作现场（正文 + 审阅建议状态 + 聊天节点列表）。
 * 左侧「历史记录」列表的单位。
 *
 * 列表顺序由显式的 `order` 决定（升序、越小越靠前）：用户可手动拖动排序，
 * 任何一次「活动」（编辑正文 / 审阅出结果 / 聊天回复）会把该项目移到最前。
 * 单纯点开查看**不算**活动，不改变位置。
 * title 取正文首段截断（见 chat-history.ts 的 deriveProjectTitle）。
 *
 * `order` 刻意是 **optional**：`listProjects` 用 safeParse 读旧数据，必填会让缺字段的
 * 既有项目校验失败、被整条丢弃（看起来像历史全没了）。旧数据在 Dexie v4 的 upgrade
 * 回填，读入路径另有兜底（见 storage/projects.ts）。
 */
export const ProjectSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  doc: DocumentStateSchema,
  reviews: z.array(ReviewItemSchema),
  nodes: z.array(ChatNodeSchema),
  lastActivityAt: z.string(),
  order: z.number().int().optional(),
});
export type Project = z.infer<typeof ProjectSchema>;
