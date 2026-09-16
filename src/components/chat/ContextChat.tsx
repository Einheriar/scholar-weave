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
import { renderMiniMarkdown } from "@/lib/mini-markdown";

export type ContextChatProps = {
  context: ChatContext;
  /** 当前上下文对应的建议（context.type==="review" 时） */
  contextReview?: ReviewItem | null;
  /** 当前查看的聊天节点（消息列表显示它的轮次；节点化聊天） */
  activeNode: ChatNode | null;
  /** 当前节点锚点是否已失效（原文被改/删，规则 12；由 page 用 canLocateScope 判定） */
  anchorStale: boolean;
  turns: ChatTurn[];
  busy: boolean;
  /** 规则 11：无选区且无选中建议时禁止提问（发送按钮禁用，由 page 拦截并提示） */
  sendDisabled: boolean;
  onSend: (message: string) => void;
  /** 打开某条回复附带的修改集预览 */
  onPreviewChangeSet: (changeSet: ChangeSet) => void;
  /** 开一篇新文章（当前项目已自动存进左侧历史，不会被丢掉） */
  onNewChat: () => void;
};

/**
 * 节点化上下文对话（项目制聊天，PLAN 7 + 锚点节点方案）。
 * 底部对话框，显示**当前聊天节点**的线性往返对话（不是全文混合流）。
 * 头部：历史按钮（阶段 4 挂节点时间线）+ 当前上下文标签 + 最小化/展开 + 新文章。
 * LLM 回复若带修改集，只显示“预览修改”入口，绝不直接改正文。
 */
export function ContextChat({
  context,
  contextReview,
  activeNode,
  anchorStale,
  turns,
  busy,
  sendDisabled,
  onSend,
  onPreviewChangeSet,
  onNewChat,
}: ContextChatProps) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [turns, busy]);

  const submit = () => {
    const text = draft.trim();
    if (!text || busy || sendDisabled) return;
    setDraft("");
    onSend(text);
  };

  const contextLabel = describeContext(context, contextReview);

  return (
    <section
      className="flex flex-col rounded-2xl border border-border bg-surface shadow-sm"
      aria-label="上下文对话"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2 text-xs">
        <span className="flex min-w-0 items-center gap-1.5 text-text-muted">
          {activeNode && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
              title="正在聊这个节点"
              aria-hidden
            />
          )}
          <span className="truncate">
            当前上下文：<span className="font-medium text-foreground">{contextLabel}</span>
          </span>
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {turns.length > 0 && (
            <button
              type="button"
              onClick={onNewChat}
              className="rounded-md px-1.5 py-0.5 text-text-faint transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              新文章
            </button>
          )}
        </div>
      </div>

      {anchorStale && (
        <p className="mx-3.5 mt-3 rounded-lg bg-surface-muted px-3 py-2 text-xs text-text-muted">
          原文已变更，以下为存档讨论
        </p>
      )}

      {turns.length > 0 && (
        <div
          ref={listRef}
          className="max-h-56 space-y-2.5 overflow-y-auto px-3.5 py-3"
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
        <button
          type="button"
          onClick={submit}
          disabled={busy || !draft.trim() || sendDisabled}
          title={sendDisabled ? "请先选中正文或一条建议" : undefined}
          className={buttonClass("primary", "md")}
        >
          发送
        </button>
      </div>
    </section>
  );
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
