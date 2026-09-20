"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeSet, ConcreteEdit, DocumentState } from "@/lib/review-schema";
import { prepareChangeSet, type PreparedChangeSet } from "@/lib/changeset";
import { buttonClass } from "@/components/ui/button";
import { renderMiniMarkdown } from "@/lib/mini-markdown";

export type ChangeSetPreviewProps = {
  changeSet: ChangeSet;
  document: DocumentState;
  /** 接受选中的修改（参数为被选中的 edit id 列表） */
  onAccept: (editIds: string[]) => boolean;
  /** 放弃整个修改集（触发关闭动画，播完由 onClosed 卸载） */
  onDiscard: () => void;
  /** 显隐：常驻渲染，靠 className 播进/出动画，closing 播完才卸载 */
  open: boolean;
  onClosed: () => void;
  /** 把当前指向的修改同步高亮到正文；null 清除高亮 */
  onPreviewEditChange: (edit: ConcreteEdit | null) => void;
  /** 点击一项时滚动到正文中的精确位置 */
  onRevealEdit: (edit: ConcreteEdit) => void;
};

/**
 * 修改集差异预览（PLAN 3.3 / 6.2）。
 * 逐条显示 原文 → 改为，可勾选，支持“接受选中 / 全部接受 / 放弃”。
 * 定位失败或重叠的修改单独列出，不可选。
 */
export function ChangeSetPreview({
  changeSet,
  document: doc,
  onAccept,
  onDiscard,
  open,
  onClosed,
  onPreviewEditChange,
  onRevealEdit,
}: ChangeSetPreviewProps) {
  const prepared = useMemo(
    () => prepareChangeSet(doc, changeSet),
    [doc, changeSet],
  );
  // Applying edits updates the document before the preview's exit animation
  // finishes. Preserve the last valid result during that closing frame so the
  // applied originals are not briefly reported as missing.
  const [acceptedPrepared, setAcceptedPrepared] =
    useState<PreparedChangeSet | null>(null);
  const { applicable, rejected } = acceptedPrepared ?? prepared;

  const applicableIds = useMemo(
    () => applicable.map((r) => r.edit.id),
    [applicable],
  );
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(applicableIds),
  );
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);

  // 键盘焦点管理：打开时进入预览，关闭时回到触发它的控件
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedRef = useRef(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current
      ?.querySelector<HTMLElement>('input[type="checkbox"], button')
      ?.focus({ preventScroll: true });
    return () => {
      previous?.focus?.({ preventScroll: true });
    };
  }, []);

  // 关闭：下一帧把进入动画换成退出动画（延迟卸载，约定 8/15），播完由 onClosed 卸载；
  // 重新打开时清掉退出标记，动画从头播
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (open) {
      closedRef.current = false;
      el.classList.remove("animate-item-out");
    } else {
      const finishClosing = () => {
        if (closedRef.current) return;
        closedRef.current = true;
        onClosed();
      };
      const raf = requestAnimationFrame(() => {
        el.classList.add("animate-item-out");
        // animationend is not guaranteed (reduced motion, background tabs, or
        // a DOM removal by a parent). Keep delayed unmount deterministic.
        closeTimerRef.current = setTimeout(finishClosing, 350);
      });
      return () => {
        cancelAnimationFrame(raf);
        if (closeTimerRef.current) {
          clearTimeout(closeTimerRef.current);
          closeTimerRef.current = null;
        }
      };
    }
  }, [open, onClosed]);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const accept = (ids: string[]) => {
    setAcceptedPrepared(prepared);
    if (!onAccept(ids)) setAcceptedPrepared(null);
  };

  const selectedIds = applicableIds.filter((id) => checked.has(id));
  const editById = useMemo(() => {
    const m = new Map<string, ConcreteEdit>();
    for (const e of changeSet.edits) m.set(e.id, e);
    return m;
  }, [changeSet]);
  const activeId = open ? (hoveredId ?? focusedId ?? pinnedId) : null;

  useEffect(() => {
    onPreviewEditChange(activeId ? (editById.get(activeId) ?? null) : null);
  }, [activeId, editById, onPreviewEditChange]);

  useEffect(
    () => () => {
      onPreviewEditChange(null);
    },
    [onPreviewEditChange],
  );

  return (
    <div
      ref={panelRef}
      className="animate-item-in flex max-h-[min(28rem,55dvh)] min-h-0 flex-col rounded-2xl border border-brand-ring bg-surface p-4 text-sm shadow-lg"
      style={{
        backgroundImage:
          "linear-gradient(color-mix(in srgb, var(--brand-soft) 60%, transparent), color-mix(in srgb, var(--brand-soft) 60%, transparent))",
      }}
      role="dialog"
      aria-labelledby="changeset-preview-title"
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && e.animationName === "item-fade-out") {
          if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
          }
          if (closedRef.current) return;
          closedRef.current = true;
          onClosed();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onDiscard();
        }
      }}
    >
      <div className="mb-3 shrink-0">
        <h3 id="changeset-preview-title" className="font-semibold tracking-tight text-foreground">
          修改集预览
        </h3>
        <p className="mt-0.5 max-h-16 overflow-y-auto overscroll-contain text-xs text-text-muted">{changeSet.summary}</p>
      </div>

      <div className="min-h-0 overflow-y-auto overscroll-contain">
        <ul className="mb-3 space-y-2">
          {applicable.map((r) => (
            <li
              key={r.edit.id}
              data-change-edit-id={r.edit.id}
              data-active={activeId === r.edit.id ? "true" : undefined}
              onPointerEnter={() => setHoveredId(r.edit.id)}
              onPointerLeave={() => setHoveredId(null)}
              onFocusCapture={() => setFocusedId(r.edit.id)}
              onBlurCapture={(event) => {
                const next = event.relatedTarget;
                if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
                  setFocusedId(null);
                }
              }}
              className={`flex items-start gap-2 rounded-xl border bg-surface p-2.5 shadow-sm transition-[border-color,box-shadow] ${
                activeId === r.edit.id
                  ? "border-brand-ring ring-1 ring-brand-ring"
                  : "border-border"
              }`}
            >
              <input
                type="checkbox"
                checked={checked.has(r.edit.id)}
                onChange={() => toggle(r.edit.id)}
                className="mt-1 accent-[#0da678]"
                aria-label={`选择修改：${r.edit.explanation || r.edit.original}`}
              />
              <button
                type="button"
                aria-label={`定位修改：${r.edit.explanation || r.edit.original}`}
                aria-pressed={pinnedId === r.edit.id}
                onClick={() => {
                  setPinnedId(r.edit.id);
                  onRevealEdit(r.edit);
                }}
                className="min-w-0 flex-1 cursor-pointer rounded-md text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
              >
                <div
                  data-change-original
                  className="min-w-0 break-words text-red-700 line-through decoration-red-400/60 dark:text-red-400"
                >
                  {r.edit.original}
                </div>
                <div
                  data-change-replacement
                  className="min-w-0 break-words font-medium text-emerald-700 dark:text-emerald-400"
                >
                  {r.edit.replacement}
                </div>
                {r.edit.explanation && (
                  <div className="mt-0.5 text-text-faint">
                    {renderMiniMarkdown(r.edit.explanation)}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>

        {rejected.size > 0 && (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
            <p className="mb-1 font-medium">以下 {rejected.size} 条无法应用：</p>
            <ul className="space-y-0.5">
              {[...rejected.entries()].map(([id, reason]) => (
                <li key={id} className="break-all">
                  · {editById.get(id)?.original ?? id}
                  <span className="text-amber-600 dark:text-amber-400">
                    （{reason === "overlap" ? "与其他修改重叠" : "原文定位失败"}）
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border pt-3">
        <button
          type="button"
          disabled={selectedIds.length === 0}
          onClick={() => accept(selectedIds)}
          className={buttonClass("primary", "xs")}
        >
          接受选中（{selectedIds.length}）
        </button>
        <button
          type="button"
          disabled={applicableIds.length === 0}
          onClick={() => accept(applicableIds)}
          className={buttonClass("secondary", "xs")}
        >
          全部接受（{applicableIds.length}）
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className={buttonClass("secondary", "xs") + " ml-auto"}
        >
          放弃
        </button>
      </div>
    </div>
  );
}
