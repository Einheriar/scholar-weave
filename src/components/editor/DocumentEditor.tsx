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
  /** 批量应用：把若干段落替换为新文本（ChangeSet 接受，阶段 4） */
  applyBlockTexts: (newTextByBlock: Map<string, string>) => boolean;
  /** 撤销：把若干段落还原为旧文本 */
  revertBlockTexts: (oldTextByBlock: Map<string, string>) => boolean;
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
  /** 选区变化回调：当前选中的（blockId, 文本），无选区时为 null（阶段 5 range 上下文） */
  onSelectionChange?: (sel: { blockId: string; text: string } | null) => void;
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
    onSelectionChange,
  },
  ref,
) {
  // 用 ref 持有最新的回调与文档，避免闭包过期；在 effect 中同步，不在渲染期写 ref
  const onChangeRef = useRef(onDocumentChange);
  const docRef = useRef(document);
  const reviewRef = useRef<ReviewDecorationConfig["items"]>(reviewItems);
  const selectedRef = useRef<string | null>(selectedReviewId);
  const onSelectRef = useRef(onSelectReview);
  const onSelChangeRef = useRef(onSelectionChange);
  useEffect(() => {
    onChangeRef.current = onDocumentChange;
    docRef.current = document;
    reviewRef.current = reviewItems;
    selectedRef.current = selectedReviewId;
    onSelectRef.current = onSelectReview;
    onSelChangeRef.current = onSelectionChange;
  }, [onDocumentChange, document, reviewItems, selectedReviewId, onSelectReview, onSelectionChange]);

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
    onSelectionUpdate({ editor }) {
      const cb = onSelChangeRef.current;
      if (!cb) return;
      const { from, to, empty } = editor.state.selection;
      if (empty) {
        cb(null);
        return;
      }
      // 找到选区起点所在的段落 blockId
      const $from = editor.state.doc.resolve(from);
      let blockId: string | null = null;
      for (let d = $from.depth; d >= 0; d--) {
        const node = $from.node(d);
        if (node.type.name === "paragraph") {
          blockId = (node.attrs.blockId as string) ?? null;
          break;
        }
      }
      const text = editor.state.doc.textBetween(from, to, " ", " ");
      cb(blockId ? { blockId, text } : null);
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
      // 选中该建议对应的正文范围（PLAN 6.2），而不是只把光标落在起点
      const size = editor.state.doc.content.size;
      const from = Math.max(0, Math.min(pos.from, size));
      const to = Math.max(from, Math.min(pos.to, size));
      editor
        .chain()
        .focus()
        .setTextSelection(to > from ? { from, to } : from)
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
    applyBlockTexts(newTextByBlock) {
      return replaceBlockTexts(editor, newTextByBlock);
    },
    revertBlockTexts(oldTextByBlock) {
      return replaceBlockTexts(editor, oldTextByBlock);
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
 * range：用锚点定位；block：整段的 **行内内容** 范围（不含段落节点边界，
 * 这样既能作为合法文本选区，也能被 insertContentAt 安全替换）。
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
    return { from: start + 1, to: start + node.nodeSize - 1 };
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

/**
 * 批量替换若干段落的文本（ChangeSet 应用 / 撤销）。
 * 一次事务内完成，从后向前替换以保持位置稳定。
 */
function replaceBlockTexts(
  editor: Editor | null,
  textByBlock: Map<string, string>,
): boolean {
  if (!editor || textByBlock.size === 0) return false;

  // 收集 (位置, 节点, 新文本)，按位置从后向前排序
  const targets: Array<{ from: number; to: number; text: string }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph") return false;
    const id = node.attrs.blockId as string | null;
    if (id && textByBlock.has(id)) {
      targets.push({
        from: pos,
        to: pos + node.nodeSize,
        text: textByBlock.get(id)!,
      });
    }
    return false;
  });
  if (targets.length === 0) return false;

  // 先收集每段的 id 与目标文本，再从后向前替换以保持位置稳定
  targets.sort((a, b) => b.from - a.from);
  let chain = editor.chain().focus();
  for (const t of targets) {
    const keepId = blockIdAt(editor, t.from);
    chain = chain.insertContentAt(
      { from: t.from, to: t.to },
      {
        type: "paragraph",
        // 保留原 blockId：普通编辑不改变 ID（PLAN 10.2）
        ...(keepId ? { attrs: { blockId: keepId } } : {}),
        content: t.text ? [{ type: "text", text: t.text }] : undefined,
      },
    );
  }
  chain.run();
  return true;
}

/** 读取某位置段落的 blockId（用于替换时保留 ID） */
function blockIdAt(editor: Editor, pos: number): string | null {
  const node = editor.state.doc.nodeAt(pos);
  return (node?.attrs.blockId as string | null) ?? null;
}
