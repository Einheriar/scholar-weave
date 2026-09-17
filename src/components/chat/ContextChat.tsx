"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ChangeSet,
  ChatContext,
  ChatNode,
  ChatTurn,
  ReviewItem,
} from "@/lib/review-schema";
import { buttonClass } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { renderMiniMarkdown } from "@/lib/mini-markdown";
import { NodeTimeline } from "./NodeTimeline";

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
  turns: ChatTurn[];
  busy: boolean;
  /** 规则 11：无选区且无选中建议时禁止提问（发送按钮禁用，由 page 拦截并提示） */
  sendDisabled: boolean;
  /** 最小化（规则 22）：收起为只有头部的窄条，方便阅读正文腾空间 */
  minimized: boolean;
  onToggleMinimize: () => void;
  onSend: (message: string) => void;
  /** 打开某条回复附带的修改集预览 */
  onPreviewChangeSet: (changeSet: ChangeSet) => void;
  /** 聊天区当前高度 px（顶部拖拽把手可调；page 持久化到 localStorage） */
  panelHeight: number;
  onResize: (height: number) => void;
  /** 点击时间线端点：切到该节点并滚动到对应轮次（规则 19） */
  onJumpToTurn: (nodeId: string, turnIndex: number) => void;
  /** 点击节点竖条或当前上下文标签：定位到该节点的正文锚点 */
  onRevealAnchor: (nodeId: string) => void;
  /** 当前无法可靠定位到正文的节点 id */
  staleNodeIds: ReadonlySet<string>;
  /** 时间线行内删除该节点全部讨论（规则 13） */
  onDeleteNode: (nodeId: string) => void;
};

/**
 * 节点化上下文对话（项目制聊天，PLAN 7 + 锚点节点方案）。
 * 底部对话框，显示**当前聊天节点**的线性往返对话（不是全文混合流）。
 * 头部：历史按钮（节点时间线抽屉）+ 当前上下文标签 + 最小化/展开。
 * 新建文章只走左栏「新文章」，这里不放（避免意义不明的重复入口）。
 * 顶部有一条拖拽把手，按住上/下拖可调聊天区高度（用户可控大小）。
 * LLM 回复若带修改集，只显示“预览修改”入口，绝不直接改正文。
 */
export function ContextChat({
  context,
  contextReview,
  nodes,
  activeNode,
  anchorStale,
  turns,
  busy,
  sendDisabled,
  minimized,
  onToggleMinimize,
  onSend,
  onPreviewChangeSet,
  panelHeight,
  onResize,
  onJumpToTurn,
  onRevealAnchor,
  staleNodeIds,
  onDeleteNode,
}: ContextChatProps) {
  const [draft, setDraft] = useState("");
  const [timelineOpen, setTimelineOpen] = useState(false);
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
  // 拖拽把手：记录起始高度与指针位置，pointermove 时差值调整
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [turns, busy]);

  // 拖拽调高：在 window 上监听 pointermove/up，松手结束
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
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [onResize]);

  const submit = () => {
    const text = draft.trim();
    if (!text || busy || sendDisabled) return;
    setDraft("");
    onSend(text);
  };

  const contextLabel = describeContext(context, contextReview);

  return (
    <section
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
                label={anchorStale ? "原文已变更，无法定位" : "定位到正文锚点"}
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
              onPointerDown={(e) => {
                dragRef.current = { startY: e.clientY, startHeight: panelHeight };
                e.currentTarget.setPointerCapture?.(e.pointerId);
              }}
              aria-label="调整聊天区高度"
              className="group flex w-full cursor-ns-resize touch-none items-center justify-center border-b border-border py-1 transition-colors hover:bg-surface-muted"
            >
              <span className="h-1 w-10 rounded-full bg-border-strong transition-colors group-hover:bg-text-faint" />
            </button>
          </Tooltip>

          {anchorStale && (
            <p className="mx-3.5 mt-3 rounded-lg bg-surface-muted px-3 py-2 text-xs text-text-muted">
              原文已变更，以下为存档讨论
            </p>
          )}

          {turns.length > 0 && (
            <div
              ref={listRef}
              className="flex-1 space-y-2.5 overflow-y-auto px-3.5 py-3"
              style={{ minHeight: 0, maxHeight: Math.max(120, panelHeight - 160) }}
            >
              {turns.map((t, i) => (
                <div
                  key={i}
                  data-turn-index={i}
                  className={
                    "animate-item-in px-3 py-2 text-sm shadow-sm " +
                    (t.role === "user"
                      ? "ml-10 rounded-2xl rounded-br-sm bg-brand text-white dark:text-neutral-950"
                      : "mr-10 rounded-2xl rounded-bl-sm bg-surface-muted text-foreground")
                  }
                >
                  <div className="break-words leading-relaxed">
                    {renderMiniMarkdown(t.content)}
                  </div>
                  {t.changeSet && (
                    <button
                      type="button"
                  onClick={() => onPreviewChangeSet(t.changeSet!)}
                  className={
                    "mt-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors " +
                    (t.role === "user"
                      ? "border-white/40 text-white hover:bg-white/15 dark:text-neutral-950"
                      : "border-brand-ring bg-surface text-brand hover:bg-brand-soft")
                  }
                >
                  预览修改（{t.changeSet.edits.length} 处）
                </button>
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
          )}

          <div className="flex items-end gap-2 border-t border-border p-2.5">
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
                  ? "先选中正文中的词/段落，或选中一条建议，再提问…"
                  : `针对${contextLabel}询问 LLM……（Enter 发送，Shift+Enter 换行）`
              }
              rows={2}
              className="flex-1 resize-none rounded-xl border border-border bg-transparent px-3 py-2 text-sm transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring"
              aria-label="对话输入框"
            />
            <Tooltip label={sendDisabled ? "请先选中正文或一条建议" : undefined} side="top" align="end">
              <button
                type="button"
                onClick={submit}
                disabled={busy || !draft.trim() || sendDisabled}
                className={buttonClass("primary", "md")}
              >
                发送
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* 常驻渲染：抽屉换 closing 关键帧播退出动画，播完由 onClosingEnd 卸载 */}
      {timelineMounted && (
        <NodeTimeline
          nodes={nodes}
          activeNodeId={activeNode?.id ?? null}
          staleNodeIds={staleNodeIds}
          closing={timelineClosing}
          onClosingEnd={() => {
            setClosingDone(true);
            setTimelineMounted(false);
          }}
          onJump={(nodeId, turnIndex) => {
            closeTimeline();
            onJumpToTurn(nodeId, turnIndex);
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
