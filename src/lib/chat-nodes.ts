import type { ChatContext, ChatNode } from "./review-schema";

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
 * 规则 11：无选区禁止提问（无 range 选区且无选中建议时不得发送），
 * 故 document 锚实际只在「用户自行全选」时经 range 进入，这里仍保留 document 分支兜底。
 */

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

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
