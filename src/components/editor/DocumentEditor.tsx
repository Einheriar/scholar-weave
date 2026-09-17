"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { closeHistory, undoDepth } from "@tiptap/pm/history";
import { BlockIdExtension } from "./BlockIdExtension";
import {
  ReviewDecorationExtension,
  reviewDecorationKey,
  type ReviewDecorationConfig,
} from "./ReviewDecorationExtension";
import {
  ChatAnchorDecorationExtension,
  chatAnchorDecorationKey,
  type ChatAnchorDecorationConfig,
} from "./ChatAnchorDecorationExtension";
import {
  docToTiptap,
  textToPMContent,
  tiptapToBlocks,
  type PMDocNode,
} from "@/lib/tiptap-convert";
import type { DocumentState, DocumentBlock, ReviewItem, ChatNode } from "@/lib/review-schema";
import { computeChecksum } from "@/lib/revisions";
import { locateRange } from "@/lib/anchoring";
import { Tooltip } from "@/components/ui/tooltip";

export type DocumentEditorHandle = {
  /** 把编辑器滚动并选中到某条建议对应的正文位置（侧栏→正文定位） */
  revealItem: (item: ReviewItem) => void;
  /** 定位聊天节点的正文锚点；范围锚恢复选区，其余类型只落光标／高亮 */
  revealChatAnchor: (node: ChatNode, reviewItem?: ReviewItem | null) => boolean;
  /** 返回某条建议标记在视口中的纵向位置（相对 document），供侧栏对齐用 */
  getItemViewportTop: (item: ReviewItem) => number | null;
  /** 应用一条可执行修改：替换其命中的文本范围（单条接受） */
  applyEdit: (item: ReviewItem) => boolean;
  /** 批量应用：把若干段落替换为新文本（ChangeSet 接受，阶段 4） */
  applyBlockTexts: (newTextByBlock: Map<string, string>) => boolean;
  /** 撤销：把若干段落还原为旧文本 */
  revertBlockTexts: (oldTextByBlock: Map<string, string>) => boolean;
  /** 安全撤销一条 edit，不覆盖用户在接受后的其他编辑 */
  revertEdit: (item: ReviewItem) => boolean;
};

export type DocumentEditorProps = {
  document: DocumentState;
  onDocumentChange: (doc: DocumentState) => void;
  /** 当前要显示的建议（阶段 2） */
  reviewItems?: ReviewItem[];
  /** 当前选中的建议 id（双向定位高亮） */
  selectedReviewId?: string | null;
  /** 点击正文标记时回调（正文→侧栏定位），带标记的视口纵坐标供侧栏对齐 */
  onSelectReview?: (id: string, viewportTop: number | null) => void;
  /** 用户选区变化回调：当前选中的（blockId, 文本），无选区时为 null；建议定位的程序化选区不会上报 */
  onSelectionChange?: (sel: { blockId: string; text: string } | null) => void;
  /** 聊天节点锚点（阶段 6）：被聊过的文字画点状下划线，点击跳节点 */
  chatNodes?: ChatNode[];
  /** 点击正文聊天锚点标记时回调（正文→聊天区对应节点） */
  onSelectChatAnchor?: (nodeId: string) => void;
  /** 请求处理中锁定正文编辑，但仍允许滚动与选择文本 */
  readOnly?: boolean;
  /** 右上角撤销入口撤回一条已接受建议后，同步恢复建议状态 */
  onReviewEditUndo?: (id: string) => void;
  /** 已接受建议因正文继续变化而无法安全撤销时通知上层 */
  onReviewEditUndoUnavailable?: () => void;
};

type ReviewUndoEntry = {
  item: ReviewItem;
  /** 接受建议时原生 Tiptap 历史所处的深度，用于与后续手动编辑保持撤销顺序。 */
  nativeDepth: number;
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
    chatNodes = [],
    onSelectChatAnchor,
    readOnly = false,
    onReviewEditUndo,
    onReviewEditUndoUnavailable,
  },
  ref,
) {
  const [canUndo, setCanUndo] = useState(false);
  const reviewUndoStackRef = useRef<ReviewUndoEntry[]>([]);
  const performUndoRef = useRef<(() => boolean) | null>(null);
  // 用 ref 持有最新的回调与文档，避免闭包过期；在 effect 中同步，不在渲染期写 ref
  const onChangeRef = useRef(onDocumentChange);
  const docRef = useRef(document);
  const reviewRef = useRef<ReviewDecorationConfig["items"]>(reviewItems);
  const selectedRef = useRef<string | null>(selectedReviewId);
  const onSelectRef = useRef(onSelectReview);
  const onSelChangeRef = useRef(onSelectionChange);
  const chatNodesRef = useRef<ChatNode[]>(chatNodes);
  const onChatAnchorRef = useRef(onSelectChatAnchor);
  const onReviewEditUndoRef = useRef(onReviewEditUndo);
  const onReviewEditUndoUnavailableRef = useRef(onReviewEditUndoUnavailable);
  /**
   * 侧栏建议定位也会创建真实的 ProseMirror 文本选区，但它的语义仍是 review，
   * 不能经 onSelectionUpdate 冒充用户手划的 range 上下文。
   */
  const locatingReviewRef = useRef(false);
  /** 惰性持有 editor.view，供 extensions 闭包内访问 DOM（不进 deps，避免重建） */
  const viewRef = useRef<Editor["view"] | null>(null);
  useEffect(() => {
    onChangeRef.current = onDocumentChange;
    // 编辑器的命令会先同步推进 docRef，再等待父组件提交新 props。
    // 子组件自己的状态更新可能抢先触发一次旧 props 重渲染，不能让旧 revision
    // 把刚完成的编辑快照覆盖掉。
    if (
      document.id !== docRef.current.id ||
      document.revision >= docRef.current.revision
    ) {
      docRef.current = document;
    }
    reviewRef.current = reviewItems;
    selectedRef.current = selectedReviewId;
    onSelectRef.current = onSelectReview;
    onSelChangeRef.current = onSelectionChange;
    chatNodesRef.current = chatNodes;
    onChatAnchorRef.current = onSelectChatAnchor;
    onReviewEditUndoRef.current = onReviewEditUndo;
    onReviewEditUndoUnavailableRef.current = onReviewEditUndoUnavailable;
  }, [onDocumentChange, document, reviewItems, selectedReviewId, onSelectReview, onSelectionChange, chatNodes, onSelectChatAnchor, onReviewEditUndo, onReviewEditUndoUnavailable]);

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
          onSelect: (id) => {
            const cb = onSelectRef.current;
            if (!cb) return;
            // 标记 span 的视口纵坐标，传「垂直中心」（top + 半高），
            // 侧栏据此把卡片中心对齐到句子中心，而非顶部对顶部。
            //（editor 实例经 viewRef 惰性获取，保持 extensions 的依赖封闭）
            let center: number | null = null;
            const root = viewRef.current?.dom;
            const el = root?.querySelector(
              `[data-review-id="${CSS.escape(id)}"]`,
            );
            if (el instanceof HTMLElement) {
              const r = el.getBoundingClientRect();
              center = r.top + r.height / 2;
            }
            cb(id, center);
          },
        }),
      }),
      ChatAnchorDecorationExtension.configure({
        getConfig: (): ChatAnchorDecorationConfig => ({
          nodes: chatNodesRef.current,
          document: docRef.current,
          onSelect: (nodeId) => {
            onChatAnchorRef.current?.(nodeId);
          },
        }),
      }),
    ],
    [],
  );

  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    extensions,
    content: docToTiptap(document) as PMDocNode,
    editorProps: {
      attributes: {
        class:
          "prose max-w-none focus:outline-none min-h-[60vh] py-7 pl-8 pr-16 leading-relaxed sm:py-9 sm:pl-10 sm:pr-16",
        "aria-label": "文档编辑器",
      },
      handleKeyDown(_view, event) {
        if (
          event.ctrlKey &&
          !event.altKey &&
          !event.shiftKey &&
          event.key.toLowerCase() === "z"
        ) {
          const handled = performUndoRef.current?.() ?? false;
          if (handled) event.preventDefault();
          return handled;
        }
        return false;
      },
    },
    onBeforeCreate() {
      reviewUndoStackRef.current = [];
    },
    onCreate() {
      setCanUndo(false);
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
      // Keep imperative editor operations coherent even if another operation
      // happens before React has committed the parent state update.
      docRef.current = next;
      onChangeRef.current(next);
    },
    onTransaction({ editor }) {
      const nextCanUndo =
        editor.can().undo() || reviewUndoStackRef.current.length > 0;
      setCanUndo((current) => (current === nextCanUndo ? current : nextCanUndo));
    },
    onSelectionUpdate({ editor }) {
      if (locatingReviewRef.current) return;
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
  }, [document.id]);

  // readOnly 可能在编辑器实例创建后变化，使用 Tiptap API 同步编辑能力。
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    performUndoRef.current = () => {
      if (!editor || readOnly) return false;

      const stack = reviewUndoStackRef.current;
      const latestReviewEdit = stack.at(-1);
      const currentNativeDepth = undoDepth(editor.state);

      // 接受建议本身不进入 ProseMirror 历史，以免正文和卡片状态分裂。
      // 只有撤完它之后产生的普通编辑，才轮到这条建议被安全反向定位撤销。
      if (
        latestReviewEdit &&
        currentNativeDepth <= latestReviewEdit.nativeDepth
      ) {
        const ok = revertSingleEdit(
          editor,
          docRef.current,
          latestReviewEdit.item,
        );
        if (!ok) {
          onReviewEditUndoUnavailableRef.current?.();
          // 已经命中这条建议，只是安全校验拒绝恢复；仍需吃掉 Ctrl+Z，
          // 避免继续落到 ProseMirror keymap 而意外撤销更早的普通编辑。
          return true;
        }
        stack.pop();
        onReviewEditUndoRef.current?.(latestReviewEdit.item.id);
        setCanUndo(editor.can().undo() || stack.length > 0);
        return true;
      }

      return editor.commands.undo();
    };
    return () => {
      performUndoRef.current = null;
    };
  }, [editor, readOnly]);

  // items / 选中项变化时触发 Decoration 重建（必须用同一个 PluginKey 作为 meta key）
  useEffect(() => {
    if (!editor) return;
    viewRef.current = editor.view;
    const tr = editor.state.tr.setMeta(reviewDecorationKey, true);
    editor.view.dispatch(tr);
  }, [editor, reviewItems, selectedReviewId]);

  // 聊天节点变化时触发聊天锚点 Decoration 重建
  useEffect(() => {
    if (!editor) return;
    const tr = editor.state.tr.setMeta(chatAnchorDecorationKey, true);
    editor.view.dispatch(tr);
  }, [editor, chatNodes]);

  useImperativeHandle(ref, () => ({
    revealItem(item) {
      if (!editor) return;
      const pos = findItemPosition(editor, docRef.current, item);
      if (pos == null) return;
      // 选中该建议对应的正文范围（PLAN 6.2），而不是只把光标落在起点
      const size = editor.state.doc.content.size;
      const from = Math.max(0, Math.min(pos.from, size));
      const to = Math.max(from, Math.min(pos.to, size));
      locatingReviewRef.current = true;
      try {
        editor
          .chain()
          .focus()
          .setTextSelection(to > from ? { from, to } : from)
          .scrollIntoView()
          .run();
      } finally {
        locatingReviewRef.current = false;
      }
    },
    revealChatAnchor(node, reviewItem) {
      if (!editor) return false;
      const pos = findChatAnchorPosition(
        editor,
        docRef.current,
        node,
        reviewItem,
      );
      if (!pos) return false;

      const size = editor.state.doc.content.size;
      const from = Math.max(0, Math.min(pos.from, size));
      const to = Math.max(from, Math.min(pos.to, size));
      editor
        .chain()
        .focus(undefined, { scrollIntoView: false })
        // 只有 range 锚恢复真实选区。review 继续使用现有建议高亮；block/document
        // 只落光标，避免 onSelectionUpdate 把它们误判成一个新的 range 上下文。
        .setTextSelection(pos.selectRange && to > from ? { from, to } : from)
        .run();
      scrollChatAnchorIntoReadableArea(editor, from);
      return true;
    },
    getItemViewportTop(item) {
      if (!editor) return null;
      const pos = findItemPosition(editor, docRef.current, item);
      if (pos == null) return null;
      try {
        const start = editor.view.coordsAtPos(pos.from);
        return start.top;
      } catch {
        return null; // 位置越界等异常按无坐标处理
      }
    },
    applyEdit(item) {
      if (!editor || item.kind !== "edit") return false;
      const pos = findItemPosition(editor, docRef.current, item);
      if (pos == null || item.replacement === undefined) return false;

      // 把建议接受前后的普通输入分成独立历史事件。建议本身仍走安全撤销栈，
      // 但右上角按钮 / Ctrl+Z 会按时间顺序在两套历史之间调度。
      editor.view.dispatch(closeHistory(editor.state.tr));
      const nativeDepth = undoDepth(editor.state);
      const applied = editor
        .chain()
        .focus()
        .insertContentAt(
          { from: pos.from, to: pos.to },
          textToPMContent(item.replacement) ?? [],
        )
        // The review card owns this operation and its persisted safe undo state.
        // Keep it out of native history so Ctrl+Z cannot desync text and status.
        .setMeta("addToHistory", false)
        .run();
      if (!applied) return false;
      editor.view.dispatch(closeHistory(editor.state.tr));
      reviewUndoStackRef.current.push({ item, nativeDepth });
      setCanUndo(true);
      return true;
    },
    applyBlockTexts(newTextByBlock) {
      return replaceBlockTexts(editor, newTextByBlock);
    },
    revertBlockTexts(oldTextByBlock) {
      return replaceBlockTexts(editor, oldTextByBlock);
    },
    revertEdit(item) {
      const reverted = revertSingleEdit(editor, docRef.current, item);
      if (!reverted) return false;
      const index = reviewUndoStackRef.current.findLastIndex(
        (entry) => entry.item.id === item.id,
      );
      if (index >= 0) reviewUndoStackRef.current.splice(index, 1);
      setCanUndo(
        Boolean(editor?.can().undo()) || reviewUndoStackRef.current.length > 0,
      );
      return true;
    },
  }));

  return (
    /* 纸张式编辑器：白卡片浮在页面底色上，内边距在编辑器本体上，
       让文本选区/光标留边一致（PLAN 布局美化） */
    <div className="relative rounded-2xl border border-border bg-surface shadow-sm transition-shadow duration-200 focus-within:shadow-md">
      <span className="editor-undo-corner">
        <Tooltip label="撤销 / Ctrl+Z" side="bottom" align="end">
          <button
            type="button"
            aria-label="撤销正文编辑"
            aria-keyshortcuts="Control+Z"
            disabled={readOnly || !canUndo}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => performUndoRef.current?.()}
            className="editor-undo-corner-button"
          >
            <span className="editor-undo-fold" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="editor-undo-relief"
              >
                <path d="M9 5 4 10l5 5" />
                <path d="M4 10h10a5 5 0 0 1 0 10h-2" />
              </svg>
            </span>
          </button>
        </Tooltip>
      </span>
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

/**
 * 把四类聊天锚点解析成 ProseMirror 位置。定位原则与正文 Decoration 相同：
 * 不能唯一定位就返回 null，绝不猜测。
 */
function findChatAnchorPosition(
  editor: Editor,
  doc: DocumentState,
  node: ChatNode,
  reviewItem?: ReviewItem | null,
): { from: number; to: number; selectRange: boolean } | null {
  const anchor = node.anchor;
  if (anchor.type === "document") {
    const start = Math.min(1, editor.state.doc.content.size);
    return { from: start, to: start, selectRange: false };
  }
  if (anchor.type === "review") {
    if (!reviewItem) return null;
    if (reviewItem.scope.type === "document") {
      const start = Math.min(1, editor.state.doc.content.size);
      return { from: start, to: start, selectRange: false };
    }
    const pos = findItemPosition(editor, doc, reviewItem);
    return pos ? { ...pos, selectRange: false } : null;
  }
  if (anchor.type === "block") {
    if (!anchor.blockId) return null;
    const start = blockStartPosition(editor, anchor.blockId);
    if (start == null) return null;
    return { from: start + 1, to: start + 1, selectRange: false };
  }
  if (!anchor.blockId || !anchor.selectedText) return null;
  const hit = locateRange(doc, {
    type: "range",
    blockId: anchor.blockId,
    original: anchor.selectedText,
  });
  if (!hit.ok) return null;
  const blockStart = blockStartPosition(editor, anchor.blockId);
  if (blockStart == null) return null;
  return {
    from: blockStart + 1 + hit.start,
    to: blockStart + 1 + hit.end,
    selectRange: true,
  };
}

/**
 * 把正文锚点放到 sticky 聊天框上方的可读区域中央，而不是简单按整个视口居中。
 * 聊天框较高时，普通 scrollIntoView({block:"center"}) 可能把目标压在其后面。
 */
function scrollChatAnchorIntoReadableArea(editor: Editor, position: number) {
  requestAnimationFrame(() => {
    let rect: { top: number; bottom: number };
    try {
      rect = editor.view.coordsAtPos(position);
    } catch {
      return;
    }
    const chat = document.querySelector('[aria-label="上下文对话"]');
    const chatTop =
      chat instanceof HTMLElement
        ? Math.min(window.innerHeight, chat.getBoundingClientRect().top)
        : window.innerHeight;
    const visibleTop = 24;
    const visibleBottom = Math.max(
      visibleTop + 120,
      Math.min(window.innerHeight - 24, chatTop - 16),
    );
    const desiredY = visibleTop + (visibleBottom - visibleTop) * 0.45;
    const currentY = (rect.top + rect.bottom) / 2;
    const delta = currentY - desiredY;
    if (Math.abs(delta) < 2) return;
    const reduce =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      navigator.webdriver;
    window.scrollBy({ top: delta, behavior: reduce ? "auto" : "smooth" });
  });
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
  addToHistory = true,
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
        content: textToPMContent(t.text),
      },
    );
  }
  if (!addToHistory) chain = chain.setMeta("addToHistory", false);
  chain.run();
  return true;
}

/**
 * 安全撤销单条 edit。
 *
 * 反向定位只使用当前正文中的 replacement 与原 scope 上下文。若用户已经
 * 改动了 replacement 周围的内容，locateRange 会失败，此处不会猜测位置，
 * 也不会用旧的整段快照覆盖后续编辑。block 级 edit 只在当前整段仍严格等于
 * 接受后文本时恢复持久化的 before 快照，正文继续变化后同样拒绝撤销。
 */
function revertSingleEdit(
  editor: Editor | null,
  fallbackDoc: DocumentState,
  item: ReviewItem,
): boolean {
  if (!editor || item.kind !== "edit") return false;
  if (item.replacement === undefined) return false;

  // 直接从 editor 当前 JSON 重建正文，避免父组件尚未完成一次 rerender 时
  // docRef 仍是接受修改前的快照。
  const currentBlocks = tiptapToBlocks(editor.getJSON() as PMDocNode).map(
    (block) => ({
      id: block.blockId,
      type: "paragraph" as const,
      text: block.text,
    }),
  );
  const currentDoc: DocumentState = {
    ...fallbackDoc,
    blocks: currentBlocks,
  };

  if (item.scope.type === "block") {
    const snapshot = item.acceptedSnapshot;
    const blockId = item.scope.blockId;
    const block = currentDoc.blocks.find((entry) => entry.id === blockId);
    if (!snapshot || !block || block.text !== snapshot.after) return false;
    return replaceBlockTexts(editor, new Map([[blockId, snapshot.before]]), false);
  }
  if (item.scope.type !== "range") return false;
  const reverseScope = {
    ...item.scope,
    original: item.replacement,
  };
  const hit = locateRange(currentDoc, reverseScope);
  if (!hit.ok) return false;

  const blockStart = blockStartPosition(editor, item.scope.blockId);
  if (blockStart == null) return false;
  editor
    .chain()
    .focus()
    .insertContentAt(
      { from: blockStart + 1 + hit.start, to: blockStart + 1 + hit.end },
      textToPMContent(item.scope.original) ?? [],
    )
    .setMeta("addToHistory", false)
    .run();
  return true;
}

/** 读取某位置段落的 blockId（用于替换时保留 ID） */
function blockIdAt(editor: Editor, pos: number): string | null {
  const node = editor.state.doc.nodeAt(pos);
  return (node?.attrs.blockId as string | null) ?? null;
}
