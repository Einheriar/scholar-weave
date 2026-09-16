"use client";

import type { ReviewItem } from "@/lib/review-schema";
import { buttonClass } from "@/components/ui/button";
import { renderMiniMarkdown } from "@/lib/mini-markdown";
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
  // 已忽略 / 已过期是「不再待处理」的终态，视觉上要弱化：
  // 背景用更浅偏灰的 surface-muted（区别于正常卡的白/绿），边框也更淡。
  const inactive = item.status === "rejected" || item.status === "stale";

  return (
    <li className="animate-item-in">
      <article
        data-review-card={item.id}
        aria-current={selected ? "true" : undefined}
        className={
          "cursor-pointer rounded-xl border p-3.5 text-sm shadow-sm transition-all duration-200 " +
          (inactive
            // 终态卡：浅灰底 + 淡边框；选中时边框加深（border-foreground/40）
            // 让「选中了」仍然明确，不因弱化而看不清
            ? "bg-surface-muted opacity-75 " +
              (selected
                ? "border-foreground/40 ring-1 ring-foreground/20"
                : "border-border")
            : selected
              ? "border-brand bg-brand-soft shadow-md ring-1 ring-brand-ring"
              : "border-border bg-surface hover:-translate-y-px hover:border-border-strong hover:shadow-md")
        }
        onClick={() => onSelect(item.id)}
      >
        {/* 头部：类型 / 类别 / 严重度 / 状态 */}
        <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="rounded-full bg-foreground/85 px-2 py-0.5 font-medium text-background">
            {KIND_LABEL[item.kind]}
          </span>
          <span className={`flex items-center gap-1 ${cat.textClass}`}>
            <span aria-hidden>{cat.icon}</span>
            {cat.label}
          </span>
          <span className={sev.className}>{sev.label}</span>
          <span
            className={`ml-auto rounded-full px-2 py-0.5 ${st.className}`}
            aria-label={`状态：${st.label}`}
          >
            {st.label}
          </span>
        </div>

        <h4 className="mb-1 font-medium tracking-tight text-foreground">{item.title}</h4>
        <div className="mb-2.5 text-sm leading-relaxed text-text-muted">
          {renderMiniMarkdown(item.explanation)}
        </div>

        {/* edit：展示 原文 → 替换（终态卡底色已是灰，内层框换成 surface 避免融掉） */}
        {item.kind === "edit" && item.replacement !== undefined && (
          <div className={`mb-2.5 space-y-1.5 rounded-lg p-2.5 text-xs ${inactive ? "bg-surface" : "bg-surface-muted"}`}>
            {item.scope.type === "range" && (
              <div className="flex gap-1.5">
                <span className="shrink-0 text-text-faint">原文</span>
                <span className="break-all text-red-700 line-through decoration-red-400/60 dark:text-red-400">
                  {item.scope.original}
                </span>
              </div>
            )}
            <div className="flex gap-1.5">
              <span className="shrink-0 text-text-faint">改为</span>
              <span className="break-all font-medium text-emerald-700 dark:text-emerald-400">
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
                className={buttonClass("primary", "xs")}
                onClick={(e) => {
                  e.stopPropagation();
                  onAccept(item.id);
                }}
              >
                接受
              </button>
              <button
                type="button"
                className={buttonClass("secondary", "xs")}
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
                className={buttonClass("secondary", "xs")}
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
                className={buttonClass("primary", "xs")}
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
              className={buttonClass("secondary", "xs")}
              onClick={(e) => {
                e.stopPropagation();
                onRevert(item.id);
              }}
            >
              撤销
            </button>
          )}

          {item.status === "stale" && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              原文已变化，无法定位
            </span>
          )}
        </div>
      </article>
    </li>
  );
}
