import type { DocumentState } from "@/lib/review-schema";

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
  content?: Array<{ type: "text"; text: string }>;
};

export function docToTiptap(doc: DocumentState): PMDocNode {
  return {
    type: "doc",
    content: doc.blocks.map((b) => ({
      type: "paragraph",
      attrs: { blockId: b.id },
      content: b.text ? [{ type: "text", text: b.text }] : undefined,
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
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join(""),
    }));
}
