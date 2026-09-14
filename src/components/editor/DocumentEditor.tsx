"use client";

import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { BlockIdExtension } from "./BlockIdExtension";
import {
  docToTiptap,
  tiptapToBlocks,
  type PMDocNode,
} from "@/lib/tiptap-convert";
import type { DocumentState, DocumentBlock } from "@/lib/review-schema";
import { computeChecksum } from "@/lib/revisions";

export type DocumentEditorProps = {
  document: DocumentState;
  /** 文档结构（含 revision/checksum 更新后的新状态）发生变化时回调 */
  onDocumentChange: (doc: DocumentState) => void;
};

/**
 * 自然段纯文本编辑器（阶段 1）。
 *
 * 职责：
 * - 用 Tiptap 渲染可编辑的多段文本；
 * - 通过 BlockIdExtension 为每段维护稳定 blockId；
 * - 每次内容变化后，把编辑器当前状态重建为 DocumentState 并回调给上层。
 *
 * 阶段 1 不接 LLM、不做 Decoration 标记（那是阶段 2）。
 */
export function DocumentEditor({
  document,
  onDocumentChange,
}: DocumentEditorProps) {
  // 用 ref 持有最新的回调与文档，避免闭包过期；在 effect 中同步，不在渲染期写 ref
  const onChangeRef = useRef(onDocumentChange);
  const docRef = useRef(document);
  useEffect(() => {
    onChangeRef.current = onDocumentChange;
    docRef.current = document;
  }, [onDocumentChange, document]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // 阶段 1 只做自然段纯文本：关闭段落以外的块级结构
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      BlockIdExtension,
    ],
    content: docToTiptap(document) as PMDocNode,
    editorProps: {
      attributes: {
        class:
          "prose max-w-none focus:outline-none min-h-[60vh] p-4 leading-relaxed",
        "aria-label": "文档编辑器",
      },
    },
    onUpdate({ editor }) {
      const json = editor.getJSON() as PMDocNode;
      const blocks = tiptapToBlocks(json);
      const current = docRef.current;

      // 结构对齐：段落数或任一 (id,text) 不一致时，以编辑器为准重建文档
      const structuralChange =
        blocks.length !== current.blocks.length ||
        blocks.some(
          (b, i) =>
            current.blocks[i]?.id !== b.blockId ||
            current.blocks[i]?.text !== b.text,
        );

      if (!structuralChange) return;

      // 编辑器已给出稳定的 blockId 序列（普通编辑保留 ID、拆分产生新 ID、
      // 合并移除被并入段的 ID），直接据此重建段落并推进 revision/checksum。
      const rebuilt: DocumentBlock[] = blocks.map((b, i) => ({
        id: b.blockId || current.blocks[i]?.id || `p_${crypto.randomUUID()}`,
        type: "paragraph" as const,
        text: b.text,
      }));
      const next: DocumentState = {
        ...current,
        blocks: rebuilt,
        revision: current.revision + 1,
        checksum: computeChecksum(rebuilt),
        updatedAt: new Date().toISOString(),
      };
      onChangeRef.current(next);
    },
  });

  // 外部文档（例如从 IndexedDB 恢复）变化时刷新编辑器内容
  const lastLoadedId = useRef<string | null>(null);
  useEffect(() => {
    if (!editor) return;
    if (lastLoadedId.current === document.id) return;
    lastLoadedId.current = document.id;
    editor.commands.setContent(docToTiptap(document) as PMDocNode);
  }, [editor, document]);

  return (
    <div className="rounded-lg border border-neutral-300 bg-white shadow-sm">
      <EditorContent editor={editor} />
    </div>
  );
}
