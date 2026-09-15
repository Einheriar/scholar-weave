"use client";

import type { ReviewItem } from "@/lib/review-schema";
import {
  CATEGORY_META,
  KIND_LABEL,
  SEVERITY_META,
  STATUS_META,
} from "./review-meta";

export type ReviewCardProps = {
  item: ReviewItem;
  selected: boolean;
  onSelect: (id: string) => void;
  /** 接受一条可执行修改（仅 edit 且 open） */
  onAccept: (id: string) => void;
  /** 忽略 */
  onReject: (id: string) => void;
  /** 撤销该建议的接受/忽略，回到 open */
  onRevert: (id: string) => void;
  /** 围绕该建议继续对话（opinion/edit 均可用，阶段 5） */
  onChat?: (id: string) => void;
  /** 按此意见生成修改集（opinion 用，阶段 5） */
  onApplyOpinion?: (id: string) => void;
  /** 是否正在为该建议生成修改集 */
  applyingOpinion?: boolean;
};

/**
 * 单条建议卡片（PLAN 6.2）。
 * opinion：主要操作是“继续询问”和“按此意见修改”（阶段 2 暂以占位按钮呈现，阶段 5 接入对话）。
 * edit：显示原文/替换内容/理由，以及“接受”“忽略”。
 */
export function ReviewCard({
  item,
  selected,
  onSelect,
  onAccept,
  onReject,
  onRevert,
  onChat,
  onApplyOpinion,
  applyingOpinion = false,
}: ReviewCardProps) {
  const cat = CATEGORY_META[item.category];
  const sev = SEVERITY_META[item.severity];
  const st = STATUS_META[item.status];
  const actionable = item.kind === "edit" && item.status === "open";
  const revertible = item.status === "accepted" || item.status === "rejected";

  return (
    <li>
      <article
        data-review-card={item.id}
        aria-current={selected ? "true" : undefined}
        className={
          "cursor-pointer rounded-lg border p-3 text-sm shadow-sm transition-colors " +
          (selected
            ? "border-blue-400 bg-blue-50 ring-1 ring-blue-300"
            : "border-neutral-200 bg-white hover:border-neutral-300") +
          (item.status === "stale" ? " opacity-60" : "")
        }
        onClick={() => onSelect(item.id)}
      >
        {/* 头部：类型 / 类别 / 严重度 / 状态 */}
        <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-medium text-white">
            {KIND_LABEL[item.kind]}
          </span>
          <span className={`flex items-center gap-1 ${cat.textClass}`}>
            <span aria-hidden>{cat.icon}</span>
            {cat.label}
          </span>
          <span className={sev.className}>{sev.label}</span>
          <span
            className={`ml-auto rounded px-1.5 py-0.5 ${st.className}`}
            aria-label={`状态：${st.label}`}
          >
            {st.label}
          </span>
        </div>

        <h4 className="mb-1 font-medium text-neutral-900">{item.title}</h4>
        <p className="mb-2 leading-relaxed text-neutral-600">
          {item.explanation}
        </p>

        {/* edit：展示 原文 → 替换 */}
        {item.kind === "edit" && item.replacement !== undefined && (
          <div className="mb-2 space-y-1 rounded-md bg-neutral-50 p-2 text-xs">
            {item.scope.type === "range" && (
              <div className="flex gap-1.5">
                <span className="shrink-0 text-neutral-400">原文</span>
                <span className="break-all text-red-700 line-through">
                  {item.scope.original}
                </span>
              </div>
            )}
            <div className="flex gap-1.5">
              <span className="shrink-0 text-neutral-400">改为</span>
              <span className="break-all font-medium text-green-700">
                {item.replacement}
              </span>
            </div>
          </div>
        )}

        {/* 操作区 */}
        <div className="flex items-center gap-2">
          {actionable && (
            <>
              <button
                type="button"
                className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
                onClick={(e) => {
                  e.stopPropagation();
                  onAccept(item.id);
                }}
              >
                接受
              </button>
              <button
                type="button"
                className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onReject(item.id);
                }}
              >
                忽略
              </button>
            </>
          )}

          {item.kind === "opinion" && item.status === "open" && (
            <>
              <button
                type="button"
                className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onChat?.(item.id);
                }}
              >
                继续询问
              </button>
              <button
                type="button"
                disabled={applyingOpinion}
                className="rounded-md border border-blue-300 px-2.5 py-1 text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                onClick={(e) => {
                  e.stopPropagation();
                  onApplyOpinion?.(item.id);
                }}
              >
                {applyingOpinion ? "生成中…" : "按此意见修改"}
              </button>
            </>
          )}

          {revertible && (
            <button
              type="button"
              className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
              onClick={(e) => {
                e.stopPropagation();
                onRevert(item.id);
              }}
            >
              撤销
            </button>
          )}

          {item.status === "stale" && (
            <span className="text-xs text-amber-600">
              原文已变化，无法定位
            </span>
          )}
        </div>
      </article>
    </li>
  );
}
