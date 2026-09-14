"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextSelection } from "@tiptap/pm/state";
import { BlockIdExtension } from "./BlockIdExtension";
import {
  ReviewDecorationExtension,
  reviewDecorationKey,
  type ReviewDecorationConfig,
} from "./ReviewDecorationExtension";
import {
  docToTiptap,
  tiptapToBlocks,
  type PMDocNode,
} from "@/lib/tiptap-convert";
import type { DocumentState, DocumentBlock, ReviewItem } from "@/lib/review-schema";
import { computeChecksum } from "@/lib/revisions";
import { locateRange } from "@/lib/anchoring";

export type DocumentEditorHandle = {
  /** 把编辑器滚动并选中到某条建议对应的正文位置（侧栏→正文定位） */
  revealItem: (item: ReviewItem) => void;
  /** 应用一条可执行修改：替换其命中的文本范围（单条接受） */
  applyEdit: (item: ReviewItem) => boolean;
};

export type DocumentEditorProps = {
  document: DocumentState;
  onDocumentChange: (doc: DocumentState) => void;
  /** 当前要显示的建议（阶段 2） */
  reviewItems?: ReviewItem[];
  /** 当前选中的建议 id（双向定位高亮） */
  selectedReviewId?: string | null;
  /** 点击正文标记时回调（正文→侧栏定位） */
  onSelectReview?: (id: string) => void;
};

/**
 * 自然段纯文本编辑器（阶段 1）+ 审阅建议标记（阶段 2）。
 * 阶段 2 不接 LLM，只渲染上层传入的固定建议并支持定位与单条接受。
 */
export const DocumentEditor = forwardRef<
  DocumentEditorHandle,
  DocumentEditorProps
>(function DocumentEditor(
  {
    document,
    onDocumentChange,
    reviewItems = [],
    selectedReviewId = null,
    onSelectReview,
  },
  ref,
) {
  // 用 ref 持有最新的回调与文档，避免闭包过期；在 effect 中同步，不在渲染期写 ref
  const onChangeRef = useRef(onDocumentChange);
  const docRef = useRef(document);
  const reviewRef = useRef<ReviewDecorationConfig["items"]>(reviewItems);
  const selectedRef = useRef<string | null>(selectedReviewId);
  const onSelectRef = useRef(onSelectReview);
  useEffect(() => {
    onChangeRef.current = onDocumentChange;
    docRef.current = document;
    reviewRef.current = reviewItems;
    selectedRef.current = selectedReviewId;
    onSelectRef.current = onSelectReview;
  }, [onDocumentChange, document, reviewItems, selectedReviewId, onSelectReview]);

  const extensions = useMemo(
    () => [
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
      ReviewDecorationExtension.configure({
        getConfig: (): ReviewDecorationConfig => ({
          items: reviewRef.current,
          selectedId: selectedRef.current,
          onSelect: (id) => onSelectRef.current?.(id),
        }),
      }),
    ],
    [],
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
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

      const structuralChange =
        blocks.length !== current.blocks.length ||
        blocks.some(
          (b, i) =>
            current.blocks[i]?.id !== b.blockId ||
            current.blocks[i]?.text !== b.text,
        );
      if (!structuralChange) return;

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

  // items / 选中项变化时触发 Decoration 重建（必须用同一个 PluginKey 作为 meta key）
  useEffect(() => {
    if (!editor) return;
    const tr = editor.state.tr.setMeta(reviewDecorationKey, true);
    editor.view.dispatch(tr);
  }, [editor, reviewItems, selectedReviewId]);

  // 外部文档（例如从 IndexedDB 恢复）变化时刷新编辑器内容
  const lastLoadedId = useRef<string | null>(null);
  useEffect(() => {
    if (!editor) return;
    if (lastLoadedId.current === document.id) return;
    lastLoadedId.current = document.id;
    editor.commands.setContent(docToTiptap(document) as PMDocNode);
  }, [editor, document]);

  useImperativeHandle(ref, () => ({
    revealItem(item) {
      if (!editor) return;
      const pos = findItemPosition(editor, docRef.current, item);
      if (pos == null) return;
      editor
        .chain()
        .focus()
        .setTextSelection(TextSelection.near(editor.state.doc.resolve(pos.from)))
        .scrollIntoView()
        .run();
    },
    applyEdit(item) {
      if (!editor || item.kind !== "edit") return false;
      const pos = findItemPosition(editor, docRef.current, item);
      if (pos == null || item.replacement === undefined) return false;
      editor
        .chain()
        .focus()
        .insertContentAt({ from: pos.from, to: pos.to }, item.replacement)
        .run();
      return true;
    },
  }));

  return (
    <div className="rounded-lg border border-neutral-300 bg-white shadow-sm">
      <EditorContent editor={editor} />
    </div>
  );
});

/**
 * 计算某条建议在 ProseMirror 文档中的位置范围。
 * range：用锚点定位；block：整段范围。
 */
function findItemPosition(
  editor: Editor,
  doc: DocumentState,
  item: ReviewItem,
): { from: number; to: number } | null {
  if (item.scope.type === "range") {
    const hit = locateRange(doc, item.scope);
    if (!hit.ok) return null;
    const blockStart = blockStartPosition(editor, item.scope.blockId);
    if (blockStart == null) return null;
    return { from: blockStart + 1 + hit.start, to: blockStart + 1 + hit.end };
  }
  if (item.scope.type === "block") {
    const start = blockStartPosition(editor, item.scope.blockId);
    if (start == null) return null;
    const node = editor.state.doc.nodeAt(start);
    if (!node) return null;
    return { from: start, to: start + node.nodeSize };
  }
  return null; // document 级无正文位置
}

/** 找到某 blockId 对应段落在 PM 文档中的起始位置 */
function blockStartPosition(editor: Editor, blockId: string): number | null {
  let found: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === "paragraph" && node.attrs.blockId === blockId) {
      found = pos;
      return false;
    }
    return node.type.name !== "paragraph";
  });
  return found;
}
