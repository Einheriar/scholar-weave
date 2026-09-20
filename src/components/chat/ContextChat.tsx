"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  ChangeSet,
  ChatContext,
  ChatImage,
  ChatNode,
  ChatTurn,
  ReviewItem,
} from "@/lib/review-schema";
import { MAX_CHAT_IMAGES } from "@/lib/review-schema";
import { buttonClass } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { renderMiniMarkdown } from "@/lib/mini-markdown";
import { processChatImageFile } from "@/lib/chat-images";
import { NodeTimeline } from "./NodeTimeline";
import { ChatImageAttachments } from "./ChatImageAttachments";

export type ContextChatProps = {
  context: ChatContext;
  /** 当前上下文对应的建议（context.type==="review" 时） */
  contextReview?: ReviewItem | null;
  /** 当前项目的全部聊天节点（节点时间线弹层用） */
  nodes: ChatNode[];
  /** 当前查看的聊天节点（消息列表显示它的轮次；节点化聊天） */
  activeNode: ChatNode | null;
  /** 当前节点锚点是否已失效（原文被改/删，规则 12；由 page 用 canLocateScope 判定） */
  anchorStale: boolean;
  /** 锚点原文仍存在，但存在多个等价位置，无法安全判断原选区 */
  anchorAmbiguous: boolean;
  turns: ChatTurn[];
  busy: boolean;
  /** Lock node mutations while any project request is in flight. */
  interactionLocked?: boolean;
  /** 默认无选区且无建议时禁发；显式包含全文后由 page 解锁。 */
  sendDisabled: boolean;
  imageInputEnabled?: boolean;
  historyHasImages?: boolean;
  /** 当前消息是否附带最新的完整文档上下文。 */
  includeFullDocument: boolean;
  /** 当前正在查看全文节点；该节点天然附带全文背景，主体开关不可关闭。 */
  documentContextActive: boolean;
  /** 是否将“包含全文”作为默认偏好。 */
  alwaysIncludeFullDocument: boolean;
  /** 切换当前消息的完整文档上下文。 */
  onToggleIncludeFullDocument: () => void;
  /** 切换“总是包含全文”偏好。 */
  onToggleAlwaysIncludeFullDocument: () => void;
  /** 最小化（规则 22）：收起为只有头部的窄条，方便阅读正文腾空间 */
  minimized: boolean;
  onToggleMinimize: () => void;
  onSend: (message: string, images?: ChatImage[]) => void;
  /** Scope key changes when the project or active node changes. */
  draftScopeKey?: string;
  /** 重新生成当前节点最后一条 assistant 回复，并原位替换旧回复。 */
  onRegenerate: (nodeId: string, assistantTurnIndex: number) => void;
  /** 打开某条回复附带的修改集预览 */
  onPreviewChangeSet: (changeSet: ChangeSet) => void;
  /** 将 assistant 轮次的候选意见转入审阅列表；已转换时定位到对应卡片 */
  onUseReviewProposal: (nodeId: string, turnIndex: number) => void;
  /** 聊天区当前高度 px（顶部拖拽把手可调；page 持久化到 localStorage） */
  panelHeight: number;
  onResize: (height: number) => void;
  /** 点击时间线端点：切到该节点并滚动到对应轮次（规则 19） */
  onJumpToTurn: (nodeId: string, turnIndex: number) => void;
  /** 切换到固定全文节点；即使还没有对话，该入口也始终存在。 */
  onSelectDocumentNode: () => void;
  /** 点击节点竖条或当前上下文标签：定位到该节点的正文锚点 */
  onRevealAnchor: (nodeId: string) => void;
  /** 当前无法可靠定位到正文的节点 id */
  staleNodeIds: ReadonlySet<string>;
  /** stale 节点中因重复文本无法唯一消歧的节点 id */
  ambiguousNodeIds: ReadonlySet<string>;
  /** 时间线行内删除该节点全部讨论（规则 13） */
  onDeleteNode: (nodeId: string) => void;
};

/**
 * 节点化上下文对话（项目制聊天，PLAN 7 + 锚点节点方案）。
 * 底部对话框，显示**当前聊天节点**的线性往返对话（不是全文混合流）。
 * 头部：历史按钮（节点时间线抽屉）+ 当前上下文标签 + 最小化/展开。
 * 新建文章只走左栏「新文章」，这里不放（避免意义不明的重复入口）。
 * 顶部有一条拖拽把手，按住上/下拖可调聊天区高度（用户可控大小）。
 * LLM 回复若带修改集，只显示“预览修改”入口；若带候选意见，则显示
 * “转为审阅意见”入口。两者都绝不直接改正文。
 */
export function ContextChat({
  context,
  contextReview,
  nodes,
  activeNode,
  anchorStale,
  anchorAmbiguous,
  turns,
  busy,
  interactionLocked = false,
  sendDisabled,
  imageInputEnabled = true,
  historyHasImages = false,
  includeFullDocument,
  documentContextActive,
  alwaysIncludeFullDocument,
  onToggleIncludeFullDocument,
  onToggleAlwaysIncludeFullDocument,
  minimized,
  onToggleMinimize,
  onSend,
  draftScopeKey,
  onRegenerate,
  onPreviewChangeSet,
  onUseReviewProposal,
  panelHeight,
  onResize,
  onJumpToTurn,
  onSelectDocumentNode,
  onRevealAnchor,
  staleNodeIds,
  ambiguousNodeIds,
  onDeleteNode,
}: ContextChatProps) {
  const [draft, setDraft] = useState("");
  const [draftImages, setDraftImages] = useState<ChatImage[]>([]);
  const [imagePendingCount, setImagePendingCount] = useState(0);
  const [imageError, setImageError] = useState<{
    kind: "input-disabled" | "attachment";
    message: string;
  } | null>(null);
  // Capability validation expires as soon as the saved configuration enables it.
  if (imageInputEnabled && imageError?.kind === "input-disabled") {
    setImageError(null);
  }
  const [lightboxImage, setLightboxImage] = useState<ChatImage | null>(null);
  const [seenDraftScopeKey, setSeenDraftScopeKey] = useState(draftScopeKey);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [contextSwitchPhase, setContextSwitchPhase] = useState<
    "idle" | "out" | "in"
  >("idle");
  // 抽屉常驻渲染：开之前是未挂载态，首次打开挂上播进入动画；
  // 退出动画播完再卸载（详见 closing 推导）。
  const [timelineMounted, setTimelineMounted] = useState(false);
  // 延迟卸载（约定 8/15）：closing 期间继续渲染，退出动画播完（onAnimationEnd）才卸载。
  // 用「渲染期 derived state」推导 closing（同 ChatHistory.tsx:44-52 的写法，
  // 避免在 effect 里同步 setState，触发 react-hooks/set-state-in-effect）。
  const [prevTimelineOpen, setPrevTimelineOpen] = useState(false);
  const [closingDone, setClosingDone] = useState(true);
  const timelineClosing = !timelineOpen && !closingDone;
  if (prevTimelineOpen !== timelineOpen) {
    setPrevTimelineOpen(timelineOpen);
    setClosingDone(timelineOpen); // 打开时收尾；关闭时进入 closing
  }
  // reduced-motion 下动画被 animation: none 关掉，onAnimationEnd 永远不来，
  // 得在关的那一刻同步收尾，否则抽屉永远卸不掉（同 ChatHistory.tsx:76-81）。
  const closeTimeline = () => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setClosingDone(true);
      setTimelineMounted(false);
    }
    setTimelineOpen(false);
  };
  const listRef = useRef<HTMLDivElement>(null);
  const contextSwitchTimerRef = useRef<number | null>(null);
  const contextSwitchEndTimerRef = useRef<number | null>(null);
  const fullContextControlRef = useRef<HTMLDivElement>(null);
  // 拖拽把手：记录起始高度与指针位置，pointermove 时差值调整
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const imageScopeRef = useRef(draftScopeKey);
  const imageGenerationRef = useRef(0);
  const lightboxCloseRef = useRef<HTMLButtonElement>(null);
  const lightboxPreviousFocusRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    imageScopeRef.current = draftScopeKey;
    imageGenerationRef.current += 1;
  }, [draftScopeKey]);

  // Clear unsent attachments synchronously when switching projects/nodes so an
  // in-flight decode cannot leak an image into the next conversation.
  if (seenDraftScopeKey !== draftScopeKey) {
    setSeenDraftScopeKey(draftScopeKey);
    setDraft("");
    setDraftImages([]);
    setImagePendingCount(0);
    setImageError(null);
    setLightboxImage(null);
  }

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [turns, busy]);

  useEffect(
    () => () => {
      if (contextSwitchTimerRef.current) {
        clearTimeout(contextSwitchTimerRef.current);
      }
      if (contextSwitchEndTimerRef.current) {
        clearTimeout(contextSwitchEndTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!lightboxImage) return;
    lightboxCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setLightboxImage(null);
      } else if (event.key === "Tab") {
        event.preventDefault();
        lightboxCloseRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      lightboxPreviousFocusRef.current?.focus();
      lightboxPreviousFocusRef.current = null;
    };
  }, [lightboxImage]);

  // 拖拽调高：在 window 上监听 pointermove/up，松手或取消时结束
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      // 往上拖（y 变小）→ 变高；钳制在 [MIN_PANEL_HEIGHT, MAX_PANEL_HEIGHT]
      const next = clampPanelHeight(d.startHeight + (d.startY - e.clientY));
      onResize(next);
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [onResize]);

  const handleImageFiles = (files: File[]) => {
    if (!imageInputEnabled) {
      setImageError({ kind: "input-disabled", message: "当前模型配置已关闭图片输入，请在设置中开启。" });
      return;
    }
    if (imagePendingCount > 0) {
      setImageError({ kind: "attachment", message: "图片处理中，请稍候再添加。" });
      return;
    }
    const available = Math.max(
      0,
      MAX_CHAT_IMAGES - draftImages.length - imagePendingCount,
    );
    if (!available) {
      setImageError({ kind: "attachment", message: `最多支持 ${MAX_CHAT_IMAGES} 张图片。` });
      return;
    }
    const selected = files.slice(0, available);
    if (files.length > available) {
      setImageError({ kind: "attachment", message: `最多支持 ${MAX_CHAT_IMAGES} 张图片。` });
    } else {
      setImageError(null);
    }
    const scopeAtStart = draftScopeKey;
    const generationAtStart = imageGenerationRef.current;
    setImagePendingCount((count) => count + selected.length);
    void Promise.allSettled(selected.map((file) => processChatImageFile(file))).then(
      (results) => {
        const currentScope =
          imageScopeRef.current === scopeAtStart &&
          imageGenerationRef.current === generationAtStart;
        if (!currentScope) return;
        const successful = results
          .filter(
            (result): result is PromiseFulfilledResult<ChatImage> =>
              result.status === "fulfilled",
          )
          .map((result) => result.value);
        const firstError = results.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        setDraftImages((current) =>
          [...current, ...successful].slice(0, MAX_CHAT_IMAGES),
        );
        if (firstError) {
          setImageError({
            kind: "attachment",
            message: firstError.reason instanceof Error
              ? firstError.reason.message
              : "图片处理失败。",
          });
        }
      },
    ).finally(() => {
      if (
        imageScopeRef.current === scopeAtStart &&
        imageGenerationRef.current === generationAtStart
      ) {
        setImagePendingCount((count) =>
          Math.max(0, count - selected.length),
        );
      }
    });
  };

  const submit = () => {
    const text = draft.trim();
    if (
      (!text && draftImages.length === 0) ||
      busy ||
      sendDisabled ||
      imagePendingCount > 0
    ) return;
    if (!imageInputEnabled && (draftImages.length > 0 || historyHasImages)) {
      setImageError({ kind: "input-disabled", message: "本次讨论包含图片，请先在模型设置中开启“图片输入”。草稿已保留。" });
      return;
    }
    const images = draftImages;
    setDraft("");
    setDraftImages([]);
    setImageError(null);
    onSend(text, images);
  };

  const toggleFullContextDefault = () => {
    if (!alwaysIncludeFullDocument) {
      const control = fullContextControlRef.current;
      if (control) {
        control.classList.remove("t-full-context-lock-confirm");
        // Force a reflow so locking again can replay the one-shot confirmation.
        void control.offsetWidth;
        control.classList.add("t-full-context-lock-confirm");
      }
    }
    onToggleAlwaysIncludeFullDocument();
  };

  /**
   * “查看审阅意见”会把聊天上下文切到一条尚无对话的新建议。
   * 先让旧消息退场，再执行定位；新上下文进入时消息区平滑收起，
   * 避免旧节点的 turns 被父级替换后在一帧内消失。
   */
  const handleReviewProposal = (
    nodeId: string,
    turnIndex: number,
    alreadyConverted: boolean,
  ) => {
    if (!alreadyConverted) {
      onUseReviewProposal(nodeId, turnIndex);
      return;
    }
    if (contextSwitchPhase !== "idle") return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      onUseReviewProposal(nodeId, turnIndex);
      return;
    }

    setContextSwitchPhase("out");
    // 卡片在抽屉收拢早期就开始定位，让视觉重心自然接到右栏。
    contextSwitchTimerRef.current = window.setTimeout(() => {
      onUseReviewProposal(nodeId, turnIndex);
    }, 90);
    contextSwitchEndTimerRef.current = window.setTimeout(() => {
      setContextSwitchPhase("in");
      contextSwitchTimerRef.current = window.setTimeout(() => {
        setContextSwitchPhase("idle");
      }, 190);
    }, 300);
  };

  const contextLabel = describeContext(context, contextReview);
  const hasMessageContent = turns.length > 0 || busy;
  const messageDrawerOpen =
    hasMessageContent && contextSwitchPhase !== "out";

  return (
    <section
      data-chat-context-transition={contextSwitchPhase}
      className={
        "relative flex flex-col border border-border bg-surface shadow-sm " +
        // 时间线抽屉展开时它贴在聊天区上沿，顶部圆角让位给抽屉（视觉上连成一体）。
        // closing 期间抽屉还在，同样让位，免得收起动画播到一半上面先变圆角。
        (timelineOpen || timelineClosing ? "rounded-b-2xl" : "rounded-2xl")
      }
      aria-label="上下文对话"
    >
      <div
        className={
          "flex items-center justify-between gap-2 px-4 py-2 text-xs " +
          (minimized ? "" : "border-b border-border")
        }
      >
        <span className="flex min-w-0 items-center gap-1.5 text-text-muted">
          <Tooltip label="聊天节点历史">
            <button
              type="button"
              onClick={() => {
                // 首次打开才挂载抽屉；之后打开播进入动画、关闭走退出动画后卸载
                if (timelineOpen) {
                  closeTimeline();
                } else {
                  setTimelineMounted(true);
                  setTimelineOpen(true);
                }
              }}
              aria-label="聊天节点历史"
              aria-expanded={timelineOpen}
              className={
                "shrink-0 rounded-md p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring " +
                (timelineOpen
                  ? "bg-node-soft text-node"
                  : "text-text-faint hover:bg-surface-muted hover:text-foreground")
              }
            >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            </button>
          </Tooltip>
          {activeNode && (
            <Tooltip label="正在聊这个节点">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-node"
                aria-hidden
              />
            </Tooltip>
          )}
          <span className="flex min-w-0 items-center truncate">
            <span className="shrink-0">当前上下文：</span>
            {activeNode ? (
              <Tooltip
                label={
                  anchorStale
                    ? anchorAmbiguous
                      ? "无法唯一确定原选区"
                      : "原文已变更，无法定位"
                    : "定位到正文锚点"
                }
              >
                <button
                  type="button"
                  disabled={anchorStale}
                  onClick={() => onRevealAnchor(activeNode.id)}
                  aria-label={`定位到当前上下文正文：${contextLabel}`}
                  className={
                    "min-w-0 truncate rounded px-1 py-0.5 font-medium underline decoration-dotted underline-offset-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-node-ring " +
                    (anchorStale
                      ? "cursor-default text-text-faint decoration-border-strong"
                      : "cursor-pointer text-foreground decoration-node hover:bg-node-soft hover:text-node")
                  }
                >
                  {contextLabel}
                </button>
              </Tooltip>
            ) : (
              <span className="truncate font-medium text-foreground">
                {contextLabel}
              </span>
            )}
          </span>
        </span>
        <button
          type="button"
          data-chat-header-toggle
          onClick={onToggleMinimize}
          aria-label="切换聊天区展开状态"
          className="min-w-6 self-stretch flex-1 cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        />
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip label={minimized ? "展开聊天区" : "最小化聊天区"} align="end">
            <button
              type="button"
              onClick={onToggleMinimize}
              aria-label={minimized ? "展开聊天区" : "最小化聊天区"}
              className="rounded-md p-1 text-text-faint transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            >
            {minimized ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <polyline points="18 15 12 9 6 15" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            )}
            </button>
          </Tooltip>
        </div>
      </div>

      {/* 身体：常驻渲染，用 grid-template-rows 0fr↔1fr 过渡做收起/展开高度动画。
          minimized 时塌成 0 高（内容 overflow hidden 裁掉），展开时撑满。
          把手、stale 提示、消息列表、输入框都常驻，靠行高压住而不是卸载——
          否则高度没过渡可动画（条件卸载是瞬间的）。 */}
      <div className={"chat-body" + (minimized ? " chat-body-min" : "")}>
        <div>
          {/* 顶部拖拽把手：按住上/下拖调整聊天区高度（用户可控大小） */}
          <Tooltip label="按住上下拖动，调整聊天区高度">
            <button
              type="button"
              data-chat-resize-handle
              onPointerDown={(e) => {
                e.preventDefault();
                dragRef.current = { startY: e.clientY, startHeight: panelHeight };
                e.currentTarget.setPointerCapture?.(e.pointerId);
              }}
              aria-label="调整聊天区高度"
              className="group flex w-full cursor-ns-resize touch-none items-center justify-center py-2 transition-colors hover:bg-surface-muted"
            >
              <span className="h-1 w-10 rounded-full bg-border-strong transition-colors group-hover:bg-text-faint" />
            </button>
          </Tooltip>

          {anchorStale && (
            <p data-chat-anchor-stale className="mx-3.5 mt-3 rounded-lg bg-surface-muted px-3 py-2 text-xs text-text-muted">
              {anchorAmbiguous
                ? "存在多处相同文字，无法唯一确定原选区；可以继续讨论，暂不提供可执行修改"
                : "原文已变更，可以继续讨论旧片段和仍存在的当前段落；暂不提供可执行修改"}
            </p>
          )}

          <div
            data-chat-message-collapse
            data-open={messageDrawerOpen ? "true" : "false"}
            className={
              "chat-message-collapse" +
              (messageDrawerOpen ? " chat-message-collapse-open" : "")
            }
          >
            <div>
              <div
                data-chat-message-transition
                data-phase={contextSwitchPhase}
                className="chat-message-transition"
              >
                <div
                  ref={listRef}
                  data-chat-message-list
                  className="flex-1 space-y-2.5 overflow-y-auto px-3.5 py-3"
                  style={{ minHeight: 0, height: Math.max(120, panelHeight - 160) }}
                >
                  {turns.map((t, i) => (
                <div
                  key={i}
                  data-turn-index={i}
                  className={
                    "relative animate-item-in px-3 py-2 text-sm shadow-sm " +
                    (t.role === "user"
                      ? "ml-10 rounded-2xl rounded-br-sm bg-brand text-white dark:text-neutral-950"
                      : "mr-14 rounded-2xl rounded-bl-sm bg-surface-muted text-foreground")
                  }
                >
                  <div className="break-words leading-relaxed">
                    {renderMiniMarkdown(t.content)}
                  </div>
                  {t.images && t.images.length > 0 && (
                    <div
                      data-chat-image-gallery
                      className="mt-2 flex flex-wrap gap-2"
                      aria-label="消息中的图片"
                    >
                      {t.images.map((image) => (
                        <button
                          key={image.id}
                          type="button"
                          aria-label={`查看图片：${image.name}`}
                          onClick={() => {
                            lightboxPreviousFocusRef.current =
                              document.activeElement instanceof HTMLElement
                                ? document.activeElement
                                : null;
                            setLightboxImage(image);
                          }}
                          className="overflow-hidden rounded-lg border border-white/30 bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
                        >
                          {/* Local data URL; next/image is not appropriate here. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={image.dataUrl}
                            alt={image.name}
                            className="h-20 w-20 object-cover transition-transform hover:scale-105"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                  {(t.changeSet || t.reviewProposal) && (
                    <div className="mt-2 flex flex-wrap justify-end gap-2">
                      {t.changeSet && (
                        <Tooltip
                          label={anchorStale ? "原文锚点已失效，请重新选择正文后生成修改" : undefined}
                          side="top"
                          align="end"
                        >
                          <button
                            type="button"
                            onClick={() => onPreviewChangeSet(t.changeSet!)}
                            disabled={anchorStale}
                            className="rounded-lg border border-brand-ring bg-surface px-2.5 py-1 text-xs font-medium text-brand transition-colors hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            预览修改（{t.changeSet.edits.length} 处）
                          </button>
                        </Tooltip>
                      )}
                      {t.reviewProposal && (
                        <Tooltip
                          label={
                            !t.reviewProposal.convertedReviewId && anchorStale
                              ? anchorAmbiguous
                                ? "无法唯一确定原选区，不能转为审阅意见"
                                : "原文已变化，无法转为审阅意见"
                              : undefined
                          }
                          side="top"
                          align="end"
                        >
                          <button
                            type="button"
                            data-review-proposal-button
                            data-converted={
                              t.reviewProposal.convertedReviewId ? "true" : "false"
                            }
                            disabled={
                              busy ||
                              !activeNode ||
                              (!t.reviewProposal.convertedReviewId && anchorStale)
                            }
                            onClick={() => {
                              if (activeNode) {
                                handleReviewProposal(
                                  activeNode.id,
                                  i,
                                  Boolean(t.reviewProposal?.convertedReviewId),
                                );
                              }
                            }}
                            aria-busy={contextSwitchPhase !== "idle"}
                            className={`${buttonClass("secondary", "xs")} t-review-proposal-action gap-1.5`}
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              {t.reviewProposal.convertedReviewId ? (
                                <>
                                  <path d="M5 12h14" />
                                  <path d="m13 6 6 6-6 6" />
                                </>
                              ) : (
                                <>
                                  <path d="M5 4h10l4 4v12H5z" />
                                  <path d="M15 4v4h4" />
                                  <path d="M9 13h6" />
                                  <path d="M12 10v6" />
                                </>
                              )}
                            </svg>
                            {t.reviewProposal.convertedReviewId
                              ? "查看审阅意见"
                              : "转为审阅意见"}
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  )}
                  {t.role === "assistant" && i === turns.length - 1 && (
                    <span className="absolute -right-12 top-1/2 -translate-y-1/2">
                      <Tooltip label={anchorStale ? "原文已变更，请重新选择正文后提问。" : "重新生成回复"} side="right">
                        <button
                          type="button"
                          aria-label="重新生成回复"
                          aria-busy={busy}
                          disabled={busy || !activeNode || anchorStale}
                          onClick={() => {
                            if (activeNode) onRegenerate(activeNode.id, i);
                          }}
                          className="t-regenerate-reply"
                        >
                          <svg
                            className="t-regenerate-reply-icon"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M20 11a8 8 0 1 0-2.34 5.66" />
                            <path d="M20 4v7h-7" />
                          </svg>
                        </button>
                      </Tooltip>
                    </span>
                  )}
                </div>
              ))}
              {busy && (
                <p className="animate-item-in mr-10 flex items-center gap-2 rounded-2xl rounded-bl-sm bg-surface-muted px-3 py-2 text-sm text-text-faint">
                  <span className="inline-flex gap-1" aria-hidden>
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-faint [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-faint [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-faint" />
                  </span>
                  正在思考…
                </p>
              )}
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-border p-2.5">
            <div
              data-chat-composer
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes("Files")) {
                  event.preventDefault();
                }
              }}
              onDrop={(event) => {
                const files = Array.from(event.dataTransfer.files);
                if (!files.length) return;
                event.preventDefault();
                event.stopPropagation();
                handleImageFiles(files);
              }}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files);
                const itemFiles = Array.from(event.clipboardData.items)
                  .filter((item) => item.kind === "file")
                  .map((item) => item.getAsFile())
                  .filter((file): file is File => Boolean(file));
                const pastedFiles = files.length ? files : itemFiles;
                if (pastedFiles.length) {
                  event.preventDefault();
                  handleImageFiles(pastedFiles);
                }
              }}
              className="rounded-2xl border border-border bg-surface transition-[border-color,box-shadow] has-[textarea:focus]:border-brand has-[textarea:focus]:ring-2 has-[textarea:focus]:ring-brand-ring"
            >
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={
                  sendDisabled
                    ? "先选中正文或一条建议，或开启“附带全文背景”后提问…"
                    : `针对${contextLabel}询问 LLM……（Enter 发送，Shift+Enter 换行）`
                }
                rows={2}
                className="block w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-sm focus:outline-none"
                aria-label="对话输入框"
              />
              <ChatImageAttachments
                images={draftImages}
                pending={imagePendingCount > 0}
                error={imageError?.message ?? null}
                onRemove={(id) => {
                  setDraftImages((current) => current.filter((image) => image.id !== id));
                  setImageError(null);
                }}
              />
              <div className="flex items-center justify-between gap-3 px-2.5 pb-2.5 pt-1">
                <div
                  ref={fullContextControlRef}
                  className={
                    "flex min-w-0 items-stretch overflow-hidden rounded-full border text-xs font-medium transition-[background-color,border-color,color,box-shadow] focus-within:ring-2 focus-within:ring-brand-ring " +
                    (includeFullDocument
                      ? "border-brand-ring bg-brand-soft text-brand"
                      : "border-transparent bg-surface-muted text-text-muted hover:border-border-strong")
                  }
                  role="group"
                  aria-label="全文背景"
                  onAnimationEnd={(event) => {
                    if (event.target === event.currentTarget) {
                      event.currentTarget.classList.remove(
                        "t-full-context-lock-confirm",
                      );
                    }
                  }}
                >
                  <Tooltip
                    label={
                      alwaysIncludeFullDocument
                        ? "已固定：以后提问默认附带全文背景"
                        : "固定为默认：以后提问自动附带全文背景"
                    }
                    side="top"
                    align="start"
                  >
                    <button
                      type="button"
                      aria-pressed={alwaysIncludeFullDocument}
                      aria-label="总是包含全文"
                      onClick={toggleFullContextDefault}
                      className={
                        "inline-flex w-9 shrink-0 items-center justify-center border-r transition-[background-color,color] focus-visible:outline-none " +
                        (alwaysIncludeFullDocument
                          ? "border-brand bg-brand text-white dark:text-neutral-950"
                          : "border-border text-text-faint hover:bg-surface hover:text-brand")
                      }
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 16 16"
                        fill={alwaysIncludeFullDocument ? "currentColor" : "none"}
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M5 2.5h6l-1 4 2 2H8.8v4.5L8 14l-.8-1V8.5H4l2-2z" />
                      </svg>
                    </button>
                  </Tooltip>
                  <Tooltip
                    label={
                      documentContextActive
                        ? "全文节点始终附带最新版本的全文背景"
                        : includeFullDocument
                        ? "本次提问将附带最新版本的全文背景"
                        : "本次提问仅使用当前选区或建议的局部背景"
                    }
                    side="top"
                    align="end"
                  >
                    <button
                      type="button"
                      aria-pressed={includeFullDocument}
                      aria-label="包含全文"
                      disabled={documentContextActive}
                      onClick={onToggleIncludeFullDocument}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 transition-colors hover:text-foreground focus-visible:outline-none disabled:cursor-default disabled:hover:text-brand"
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M4 2.5h5l3 3v8H4z" />
                        <path d="M9 2.5v3h3" />
                      </svg>
                      附带全文背景
                    </button>
                  </Tooltip>
                </div>
                <Tooltip
                  label={
                    imagePendingCount > 0
                      ? "图片处理中，请稍候"
                      : sendDisabled
                        ? "请先选中正文或一条建议，或开启“附带全文背景”"
                        : undefined
                  }
                  side="top"
                  align="end"
                >
                  <button
                    type="button"
                    onClick={submit}
                    disabled={
                      busy ||
                      sendDisabled ||
                      imagePendingCount > 0 ||
                      (!draft.trim() && draftImages.length === 0)
                    }
                    className={`${buttonClass("primary", "md")} min-w-20`}
                  >
                    发送
                  </button>
                </Tooltip>
              </div>
            </div>
          </div>
        </div>
      </div>

      {lightboxImage && typeof document !== "undefined" && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`图片预览：${lightboxImage.name}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
          onClick={(event) => {
            if (event.target === event.currentTarget) setLightboxImage(null);
          }}
        >
          <div className="relative max-h-full max-w-full rounded-xl bg-surface p-2 shadow-xl">
            <button
              type="button"
              aria-label="关闭图片预览"
              onClick={() => setLightboxImage(null)}
              ref={lightboxCloseRef}
              className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-surface/90 text-lg text-text-muted shadow-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            >
              ×
            </button>
            {/* Local data URL; next/image is not appropriate here. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxImage.dataUrl}
              alt={lightboxImage.name}
              className="max-h-[80vh] max-w-[min(90vw,1000px)] object-contain"
            />
          </div>
        </div>,
        document.body,
      )}

      {/* 常驻渲染：抽屉换 closing 关键帧播退出动画，播完由 onClosingEnd 卸载 */}
      {timelineMounted && (
        <NodeTimeline
          nodes={nodes}
          interactionLocked={interactionLocked}
          activeNodeId={activeNode?.id ?? null}
          documentContextActive={documentContextActive}
          staleNodeIds={staleNodeIds}
          ambiguousNodeIds={ambiguousNodeIds}
          closing={timelineClosing}
          onClosingEnd={() => {
            setClosingDone(true);
            setTimelineMounted(false);
          }}
          onJump={(nodeId, turnIndex) => {
            closeTimeline();
            onJumpToTurn(nodeId, turnIndex);
          }}
          onSelectDocument={() => {
            closeTimeline();
            onSelectDocumentNode();
          }}
          onRevealAnchor={(nodeId) => {
            closeTimeline();
            onRevealAnchor(nodeId);
          }}
          onDeleteNode={onDeleteNode}
          onClose={closeTimeline}
        />
      )}
    </section>
  );
}

/** 聊天区高度钳制范围（拖拽把手可调） */
const MIN_PANEL_HEIGHT = 180;
const MAX_PANEL_HEIGHT = 720;
function clampPanelHeight(h: number): number {
  return Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, Math.round(h)));
}

function describeContext(
  context: ChatContext,
  review?: ReviewItem | null,
): string {
  switch (context.type) {
    case "document":
      return "全文";
    case "block":
      return "当前段落";
    case "range":
      return context.selectedText
        ? `选区「${truncate(context.selectedText)}」`
        : "选区";
    case "review":
      return review ? `建议「${truncate(review.title)}」` : "某条建议";
  }
}

function truncate(s: string, n = 12): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
