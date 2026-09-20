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

export const ReviewSeveritySchema = z.enum([
  "info",
  "suggestion",
  "important",
]);
export type ReviewSeverity = z.infer<typeof ReviewSeveritySchema>;

export const ReviewStatusSchema = z.enum([
  "open",
  "accepted",
  "rejected",
  "stale",
]);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const AcceptedChangeSetSnapshotEntrySchema = z.object({
  blockId: z.string().min(1),
  before: z.string(),
  after: z.string(),
});
export type AcceptedChangeSetSnapshotEntry = z.infer<
  typeof AcceptedChangeSetSnapshotEntrySchema
>;

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
    severity: ReviewSeveritySchema,
    title: z.string(),
    explanation: z.string(),
    replacement: z.string().optional(),
    status: ReviewStatusSchema,
    /**
     * block edit 接受时的可逆快照。仅在当前整段仍严格等于 after 时才允许恢复 before，
     * 因而可以跨刷新撤销，又不会覆盖用户接受后继续做的编辑。
     */
    acceptedSnapshot: z
      .object({ before: z.string(), after: z.string() })
      .optional(),
    /**
     * opinion 经 ChangeSet 接受后的多段可逆快照。只有相关段落仍逐字等于 after
     * 时才允许恢复，避免撤销覆盖用户后续编辑。
     */
    acceptedChangeSetSnapshot: z
      .array(AcceptedChangeSetSnapshotEntrySchema)
      .min(1)
      .optional(),
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
 * 浏览器本地生成的 range 锚定证据。它只随 ChatNode 持久化，不属于
 * ChatContext，也不会进入发给模型的请求或提示词。
 */
export const ChatRangeLocatorSchema = z
  .object({
    /** 选区在建档时段落文本中的 UTF-16 起止偏移 */
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    /** 短上下文用于正文变化后的安全消歧 */
    prefix: z.string(),
    suffix: z.string(),
    /** 建档时所在段落的完整快照，用于位置迁移与最终校验 */
    blockText: z.string(),
  })
  .refine((value) => value.end > value.start, {
    message: "range locator 的 end 必须大于 start",
    path: ["end"],
  });
export type ChatRangeLocator = z.infer<typeof ChatRangeLocatorSchema>;

/**
 * 对话回复中由模型提出、但尚未进入审阅列表的候选意见。
 * id 由服务端生成；转换后的 reviewId 写回候选，防止刷新后重复创建。
 * scope / kind / status / documentRevision 一律由客户端依据聊天节点和当前文档补齐，
 * 不信任模型生成锚点或执行语义。
 */
export const ChatReviewProposalSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  explanation: z.string().trim().min(1).max(10_000),
  category: ReviewCategorySchema,
  severity: ReviewSeveritySchema,
  convertedReviewId: z.string().min(1).optional(),
});
export type ChatReviewProposal = z.infer<typeof ChatReviewProposalSchema>;

/**
 * An image attached to a chat turn. Images are kept as data URLs so the
 * browser can persist the exact user attachment with the project and the
 * server can forward it to OpenAI-compatible vision endpoints.
 */
export const MAX_CHAT_IMAGES = 4;
export const MAX_CHAT_IMAGE_BYTES = 2 * 1024 * 1024;

const CHAT_IMAGE_DATA_URL_PATTERN =
  /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

/** Return the decoded byte count represented by a validated base64 payload. */
export function getChatImageDecodedBytes(dataUrl: string): number {
  const match = CHAT_IMAGE_DATA_URL_PATTERN.exec(dataUrl);
  if (!match) return 0;
  const payload = match[2];
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.floor(payload.length * 3 / 4) - padding;
}

export const ChatImageSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  dataUrl: z.string().superRefine((value, ctx) => {
    const match = CHAT_IMAGE_DATA_URL_PATTERN.exec(value);
    if (!match) {
      ctx.addIssue({
        code: "custom",
        message: "图片必须是 PNG、JPEG 或 WebP 的 base64 data URL。",
      });
      return;
    }
    const payload = match[2];
    // Base64 must be complete quanta, with padding only at the end.
    if (payload.length % 4 !== 0) {
      ctx.addIssue({ code: "custom", message: "图片 base64 编码不完整。" });
      return;
    }
    const bytes = getChatImageDecodedBytes(value);
    if (bytes <= 0 || bytes > MAX_CHAT_IMAGE_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: `图片大小必须在 1B 到 ${MAX_CHAT_IMAGE_BYTES}B 之间。`,
      });
    }
  }),
});
export type ChatImage = z.infer<typeof ChatImageSchema>;

export const ChatImagesSchema = z.array(ChatImageSchema).max(MAX_CHAT_IMAGES);

/**
 * 一轮对话（用户提问或模型回复）。
 * assistant 轮可以挂一个修改集，点击可重新打开预览——正文不会被隐式修改，
 * 修改集里定位不到的条目由 ChangeSetPreview 在渲染时判定为不可应用。
 */
export const ChatTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  images: ChatImagesSchema.optional(),
  changeSet: ChangeSetSchema.optional(),
  reviewProposal: ChatReviewProposalSchema.optional(),
}).superRefine((turn, ctx) => {
  if (turn.role === "user" && (turn.changeSet || turn.reviewProposal)) {
    ctx.addIssue({
      code: "custom",
      message: "user 轮次不能携带修改集或候选审阅意见",
    });
  }
  if (turn.role === "assistant" && turn.images) {
    ctx.addIssue({
      code: "custom",
      path: ["images"],
      message: "assistant 轮次不能携带用户图片。",
    });
  }
  if (turn.changeSet && turn.reviewProposal) {
    ctx.addIssue({
      code: "custom",
      message: "同一轮回复不能同时携带修改集和候选审阅意见",
    });
  }
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
  /** range 节点的本地定位证据；optional 以兼容 0.3.0 及更早项目 */
  rangeLocator: ChatRangeLocatorSchema.optional(),
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
 * title is derived locally from the first non-empty paragraph when no manual
 * document title exists (see deriveProjectTitle in chat-history.ts).
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
