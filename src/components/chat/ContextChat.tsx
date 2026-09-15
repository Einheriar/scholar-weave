"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ChangeSet,
  ChatContext,
  ReviewItem,
} from "@/lib/review-schema";

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
  /** assistant 回复若带修改集，这里挂其 id，点击可打开预览 */
  changeSet?: ChangeSet;
};

export type ContextChatProps = {
  context: ChatContext;
  /** 当前上下文对应的建议（context.type==="review" 时） */
  contextReview?: ReviewItem | null;
  turns: ChatTurn[];
  busy: boolean;
  onSend: (message: string) => void;
  /** 打开某条回复附带的修改集预览 */
  onPreviewChangeSet: (changeSet: ChangeSet) => void;
  onClear: () => void;
};

/**
 * 上下文对话（PLAN 7）。
 * 底部对话框，根据当前选择显示上下文（全文/第 N 段/某条建议/选区）。
 * LLM 回复若带修改集，只显示“预览修改”入口，绝不直接改正文。
 */
export function ContextChat({
  context,
  contextReview,
  turns,
  busy,
  onSend,
  onPreviewChangeSet,
  onClear,
}: ContextChatProps) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [turns, busy]);

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    onSend(text);
  };

  const contextLabel = describeContext(context, contextReview);

  return (
    <section
      className="flex flex-col rounded-lg border border-neutral-300 bg-white"
      aria-label="上下文对话"
    >
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-1.5 text-xs">
        <span className="text-neutral-500">
          当前上下文：<span className="font-medium text-neutral-700">{contextLabel}</span>
        </span>
        {turns.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-neutral-400 hover:text-neutral-600"
          >
            清空对话
          </button>
        )}
      </div>

      {turns.length > 0 && (
        <div
          ref={listRef}
          className="max-h-56 space-y-2 overflow-y-auto px-3 py-2"
        >
          {turns.map((t, i) => (
            <div
              key={i}
              className={
                "rounded-md px-2.5 py-1.5 text-sm " +
                (t.role === "user"
                  ? "ml-8 bg-blue-600 text-white"
                  : "mr-8 bg-neutral-100 text-neutral-800")
              }
            >
              <p className="whitespace-pre-wrap break-words">{t.content}</p>
              {t.changeSet && (
                <button
                  type="button"
                  onClick={() => onPreviewChangeSet(t.changeSet!)}
                  className="mt-1 rounded border border-blue-300 bg-white px-2 py-0.5 text-xs text-blue-700 hover:bg-blue-50"
                >
                  预览修改（{t.changeSet.edits.length} 处）
                </button>
              )}
            </div>
          ))}
          {busy && (
            <p className="mr-8 rounded-md bg-neutral-100 px-2.5 py-1.5 text-sm text-neutral-400">
              正在思考…
            </p>
          )}
        </div>
      )}

      <div className="flex items-end gap-2 border-t border-neutral-200 p-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={`针对${contextLabel}询问 LLM……（Enter 发送，Shift+Enter 换行）`}
          rows={2}
          className="flex-1 resize-none rounded-md border border-neutral-300 px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
          aria-label="对话输入框"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || !draft.trim()}
          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
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
