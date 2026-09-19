import type { DocumentState } from "@/lib/review-schema";
import type { Node as PMNode } from "@tiptap/pm/model";

/** Preserve hardBreak as one newline, matching paragraph offsets in DocumentState. */
export function pmPlainText(
  node: PMNode,
  from = 0,
  to = node.content.size,
): string {
  return node.textBetween(from, to, " ", (leaf) =>
    leaf.type.name === "hardBreak" ? "\n" : "",
  );
}

/**
 * DocumentState（按段落的稳定模型）与 Tiptap/ProseMirror 文档 JSON 之间的转换。
 * 段落顺序一一对应；段落数即顶层 paragraph 节点数。
 */

export type PMDocNode = {
  type: "doc";
  content: PMParagraph[];
};

export type PMParagraph = {
  type: "paragraph";
  attrs?: { blockId?: string | null };
  content?: PMInlineNode[];
};

export type PMInlineNode =
  | { type: "text"; text: string }
  | { type: "hardBreak" };

/** 把模型中的换行字符编码成 Tiptap 的 hardBreak inline 节点。 */
export function textToPMContent(text: string): PMInlineNode[] | undefined {
  if (!text) return undefined;
  const content: PMInlineNode[] = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (line) content.push({ type: "text", text: line });
    if (index < lines.length - 1) content.push({ type: "hardBreak" });
  });
  return content.length > 0 ? content : undefined;
}

export function docToTiptap(doc: DocumentState): PMDocNode {
  return {
    type: "doc",
    content: doc.blocks.map((b) => ({
      type: "paragraph",
      attrs: { blockId: b.id },
      content: textToPMContent(b.text),
    })),
  };
}

export type TiptapBlock = { blockId: string; text: string };

/** 从 Tiptap 文档 JSON 提取按顺序的段落（含 blockId 与纯文本） */
export function tiptapToBlocks(json: PMDocNode): TiptapBlock[] {
  if (!json || !Array.isArray(json.content)) return [];
  return json.content
    .filter((n): n is PMParagraph => n.type === "paragraph")
    .map((p) => ({
      blockId: (p.attrs?.blockId as string) ?? "",
      text: (p.content ?? [])
        .map((c) => (c.type === "hardBreak" ? "\n" : c.text))
        .join(""),
    }));
}
