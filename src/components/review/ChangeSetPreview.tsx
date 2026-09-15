"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeSet, ConcreteEdit, DocumentState } from "@/lib/review-schema";
import { prepareChangeSet } from "@/lib/changeset";

export type ChangeSetPreviewProps = {
  changeSet: ChangeSet;
  document: DocumentState;
  /** 接受选中的修改（参数为被选中的 edit id 列表） */
  onAccept: (editIds: string[]) => void;
  /** 放弃整个修改集 */
  onDiscard: () => void;
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
}: ChangeSetPreviewProps) {
  const { applicable, rejected } = useMemo(
    () => prepareChangeSet(doc, changeSet),
    [doc, changeSet],
  );

  const applicableIds = useMemo(
    () => applicable.map((r) => r.edit.id),
    [applicable],
  );
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(applicableIds),
  );

  // 键盘焦点管理：打开时进入预览，关闭时回到触发它的控件
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current
      ?.querySelector<HTMLElement>('input[type="checkbox"], button')
      ?.focus();
    return () => previous?.focus?.();
  }, []);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectedIds = applicableIds.filter((id) => checked.has(id));
  const editById = useMemo(() => {
    const m = new Map<string, ConcreteEdit>();
    for (const e of changeSet.edits) m.set(e.id, e);
    return m;
  }, [changeSet]);

  return (
    <div
      ref={panelRef}
      className="rounded-lg border border-blue-300 bg-blue-50/60 p-3 text-sm"
      role="dialog"
      aria-labelledby="changeset-preview-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onDiscard();
        }
      }}
    >
      <div className="mb-2">
        <h3 id="changeset-preview-title" className="font-semibold text-neutral-800">
          修改集预览
        </h3>
        <p className="mt-0.5 text-xs text-neutral-600">{changeSet.summary}</p>
      </div>

      <ul className="mb-2 max-h-64 space-y-1.5 overflow-y-auto">
        {applicable.map((r) => (
          <li
            key={r.edit.id}
            className="flex items-start gap-2 rounded-md border border-neutral-200 bg-white p-2"
          >
            <input
              type="checkbox"
              checked={checked.has(r.edit.id)}
              onChange={() => toggle(r.edit.id)}
              className="mt-1"
              aria-label={`选择修改：${r.edit.explanation || r.edit.original}`}
            />
            <div className="min-w-0 flex-1 text-xs">
              <div className="break-all text-red-700 line-through">
                {r.edit.original}
              </div>
              <div className="break-all font-medium text-green-700">
                {r.edit.replacement}
              </div>
              {r.edit.explanation && (
                <div className="mt-0.5 text-neutral-500">{r.edit.explanation}</div>
              )}
            </div>
          </li>
        ))}
      </ul>

      {rejected.size > 0 && (
        <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          <p className="mb-1 font-medium">以下 {rejected.size} 条无法应用：</p>
          <ul className="space-y-0.5">
            {[...rejected.entries()].map(([id, reason]) => (
              <li key={id} className="break-all">
                · {editById.get(id)?.original ?? id}
                <span className="text-amber-600">
                  （{reason === "overlap" ? "与其他修改重叠" : "原文定位失败"}）
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={selectedIds.length === 0}
          onClick={() => onAccept(selectedIds)}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
        >
          接受选中（{selectedIds.length}）
        </button>
        <button
          type="button"
          disabled={applicableIds.length === 0}
          onClick={() => onAccept(applicableIds)}
          className="rounded-md border border-blue-300 px-3 py-1.5 text-xs text-blue-700 hover:bg-blue-100 disabled:opacity-40"
        >
          全部接受（{applicableIds.length}）
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="ml-auto rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100"
        >
          放弃
        </button>
      </div>
    </div>
  );
}
