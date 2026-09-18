import type {
  ChatContext,
  ChatNode,
  ReviewItem,
  ReviewScope,
} from "./review-schema";

/**
 * 聊天节点的纯函数工具（项目制聊天 / 锚点节点）。
 * 只做节点身份判定与取值，不碰存储也不碰 React。
 *
 * 节点身份（规则 8）决定「这条提问接旧节点还是开新节点」：
 * - review 锚：按 reviewId 认（同一建议的提问永远接同一条线）；
 * - range 锚：按选区原文逐字相同认（位置 / 前后缀不参与——选区大小略有出入算同一节点，
 *   选中另一段文字就开新行）；
 * - block 锚：按 blockId 认（同一段反复问 = 同一节点）；
 * - document 锚：整篇共用固定全文档节点。
 *
 * 时间线始终展示一个虚拟全文入口；首次在其中发送时才创建并持久化真正的
 * document 节点。虚拟 id 只存在于界面状态，绝不写入 Project.nodes。
 */

export const VIRTUAL_DOCUMENT_NODE_ID = "__virtual_document_chat__";

/** 在现有节点里找「身份相同」的那一个，找不到返回 null（由调用方决定新建） */
export function findNodeByAnchor(
  nodes: ChatNode[],
  anchor: ChatContext,
): ChatNode | null {
  switch (anchor.type) {
    case "review": {
      const rid = anchor.reviewId;
      if (!rid) return null;
      return nodes.find((n) => n.anchor.type === "review" && n.anchor.reviewId === rid) ?? null;
    }
    case "range": {
      // 仅按选区原文逐字相同认，blockId / 位置 / 前后缀不参与
      const text = anchor.selectedText;
      if (!text) return null;
      return (
        nodes.find(
          (n) => n.anchor.type === "range" && n.anchor.selectedText === text,
        ) ?? null
      );
    }
    case "block": {
      const bid = anchor.blockId;
      if (!bid) return null;
      return nodes.find((n) => n.anchor.type === "block" && n.anchor.blockId === bid) ?? null;
    }
    case "document":
      return nodes.find((n) => n.anchor.type === "document") ?? null;
  }
}

/**
 * 节点标题（时间线 hover 摘要用）：取锚点原文截断。
 * review 锚取不到原文（标题在 ReviewItem 上），给占位；range 锚取选区原文。
 */
export function deriveNodeTitle(node: ChatNode, max = 12): string {
  const text = node.originalText.trim();
  if (text) return text.length > max ? `${text.slice(0, max)}…` : text;
  switch (node.anchor.type) {
    case "range":
      return node.anchor.selectedText
        ? truncate(node.anchor.selectedText, max)
        : "选区讨论";
    case "block":
      return "段落讨论";
    case "review":
      return "建议讨论";
    case "document":
      return "全文讨论";
  }
}

/**
 * 把聊天节点的可信锚点转换成新审阅意见的 scope。
 * review 节点继承原建议 scope；其余节点只复用应用自己保存的锚点，
 * 绝不接受 LLM 返回的 blockId、original 或字符坐标。
 */
export function reviewScopeFromNode(
  node: ChatNode,
  reviews: ReviewItem[],
): ReviewScope | null {
  const anchor = node.anchor;
  switch (anchor.type) {
    case "document":
      return { type: "document" };
    case "block":
      return anchor.blockId
        ? { type: "block", blockId: anchor.blockId }
        : null;
    case "range":
      return anchor.blockId && anchor.selectedText
        ? {
            type: "range",
            blockId: anchor.blockId,
            original: anchor.selectedText,
          }
        : null;
    case "review": {
      const source = reviews.find((item) => item.id === anchor.reviewId);
      if (!source) return null;
      return { ...source.scope };
    }
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
