"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReviewItem } from "@/lib/review-schema";
import { buttonClass } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
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
  /** 接受一条可执行修改（仅 edit 且 open）。返回 false 表示应用失败（锚点丢失等），调用方应回滚动画 */
  onAccept: (id: string) => boolean;
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
  /** 付费请求进行期间禁止会改变正文/建议状态的操作 */
  interactionLocked?: boolean;
};

/**
 * 单条建议卡片（PLAN 6.2）。
 * opinion：主要操作是"继续询问"和"按此意见修改"（阶段 2 暂以占位按钮呈现，阶段 5 接入对话）。
 * edit：显示原文/替换内容/理由，以及"接受""忽略"。
 *
 * 「接受」动画（2026-09-16 反馈修订）：
 *   accepting 态 → 覆盖全卡的勾号过场（模糊化背景内容）→ 散去 → 高度收起（grid-template-rows 0fr）
 *   → 终态 = 三行（头部 + 标题 + 按钮），视觉弱化（bg-surface-muted opacity-75）。
 *   交互锁定到收起完成（onCollapseDone），期间不响应点击。
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
  interactionLocked = false,
}: ReviewCardProps) {
  const cat = CATEGORY_META[item.category];
  const sev = SEVERITY_META[item.severity];
  const actionable = item.kind === "edit" && item.status === "open";

  // ===== accepting 状态机 =====
  // collapsed 本地 state 驱动收起 class：勾号散去后 setCollapsed(true) → CSS 动画触发
  // 收起完成后（300ms）调 onAccept 提交真实状态 + 解锁交互
  // 刷新后 item.status 已是 accepted → 用 derived-state 同步 collapsed=true（不播动画）
  // 用户撤销 → item.status 翻回 open → derived-state 同步 collapsed=false（展开）
  const [accepting, setAccepting] = useState(false);
  const [checkState, setCheckState] = useState<"hidden" | "in" | "out">("hidden");
  // 初次挂载时如果已是 accepted（刷新场景），直接收起（不播动画）
  const [collapsed, setCollapsed] = useState(() => item.status === "accepted");
  const checkTimerRef = useRef<number | null>(null);
  const collapseTimerRef = useRef<number | null>(null);

  // 卸载时清 pending 定时器（防止内存泄漏）
  useEffect(() => () => {
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
  }, []);

  const handleAccept = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (accepting || interactionLocked) return;
      setAccepting(true);
      setCheckState("in");
      // 勾号动画 500ms，散去 200ms，共 700ms
      checkTimerRef.current = window.setTimeout(() => {
        setCheckState("out");
        // 散去后再触发高度收起
        collapseTimerRef.current = window.setTimeout(() => {
          setCollapsed(true);
          const ok = onAccept(item.id);
          window.setTimeout(() => {
            setAccepting(false);
            setCheckState("hidden");
            // applyEdit 失败（锚点丢失等）：回滚收起，卡片恢复展开
            if (!ok) setCollapsed(false);
          }, 300);
        }, 200);
      }, 500);
    },
    [accepting, interactionLocked, item.id, onAccept],
  );

  // derived-state：item.status 变化时同步 collapsed
  // 初次挂载时如果 item.status 已是 accepted（刷新场景），直接初始化 collapsed=true
  const [prevStatus, setPrevStatus] = useState(item.status);
  if (prevStatus !== item.status) {
    setPrevStatus(item.status);
    if (item.status === "accepted") {
      if (!collapsed) setCollapsed(true);
    }
    if (item.status === "open") {
      if (collapsed) setCollapsed(false);
      if (accepting) setAccepting(false);
      if (checkState !== "hidden") setCheckState("hidden");
    }
  }

  // 视觉状态：collapsed（收起完成后）→ 用 accepted 视觉（灰底弱化）
  // accepting 期间（勾号过场）保持原视觉，不收起不变灰
  const visualStatus = collapsed ? "accepted" : item.status;
  const visualSt = STATUS_META[visualStatus];
  // accepted / rejected / stale 都算「终态弱化」：灰底 + opacity-75
  const visualInactive = visualStatus !== "open";
  const visualRevertible = visualStatus === "accepted" || visualStatus === "rejected";

  return (
    <li className="animate-item-in">
      <article
        data-review-card={item.id}
        aria-current={selected ? "true" : undefined}
        className={
          "relative cursor-pointer rounded-xl border p-3.5 text-sm shadow-sm transition-all duration-200 " +
          (visualInactive
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
        onClick={() => {
          if (accepting) return;
          onSelect(item.id);
        }}
      >
        {/* accepting 覆盖层：勾号过场，背景内容模糊化 */}
        {checkState !== "hidden" && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center rounded-xl"
            style={{
              background: "color-mix(in srgb, var(--surface) 82%, transparent)",
              backdropFilter: "blur(4px)",
              WebkitBackdropFilter: "blur(4px)",
            }}
          >
            <span
              className="t-success-check"
              data-state={checkState}
              aria-hidden="true"
              style={{ width: 48, height: 48 }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--brand)"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ width: "100%", height: "100%" }}
              >
                <path d="M4.5 12.5l5 5L19.5 7" />
              </svg>
            </span>
          </div>
        )}

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
            className={`ml-auto rounded-full px-2 py-0.5 ${visualSt.className}`}
            aria-label={`状态：${visualSt.label}`}
          >
            {visualSt.label}
          </span>
        </div>

        <h4 className="mb-1 font-medium tracking-tight text-foreground">{item.title}</h4>

        {/* 可收起区：解释段 + 原文/改为框。收起后卡片只剩 头部 + 标题 + 按钮（三行）。 */}
        <div
          className={
            "review-card-collapsible" +
            (collapsed ? " collapsed" : "")
          }
        >
          <div>
            <div className="mb-2.5 text-sm leading-relaxed text-text-muted">
              {renderMiniMarkdown(item.explanation)}
            </div>

            {/* edit：展示 原文 → 替换（终态卡底色已是灰，内层框换成 surface 避免融掉） */}
            {item.kind === "edit" && item.replacement !== undefined && (
              <div className={`mb-2.5 space-y-1.5 rounded-lg p-2.5 text-xs ${visualInactive ? "bg-surface" : "bg-surface-muted"}`}>
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
          </div>
        </div>

        {/* 操作区：不收起，「撤销」一直可点 */}
        <div className="flex items-center gap-2">
          {actionable && !accepting && (
            <>
              <Tooltip label={interactionLocked ? "请求处理中，请等待完成" : undefined}>
                <button
                  type="button"
                  disabled={interactionLocked}
                  className={buttonClass("primary", "xs")}
                  onClick={handleAccept}
                >
                  接受
                </button>
              </Tooltip>
              <Tooltip label={interactionLocked ? "请求处理中，请等待完成" : undefined}>
                <button
                  type="button"
                  disabled={interactionLocked}
                  className={buttonClass("secondary", "xs")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onReject(item.id);
                  }}
                >
                  忽略
                </button>
              </Tooltip>
            </>
          )}

          {item.kind === "opinion" && item.status === "open" && !accepting && (
            <>
              <Tooltip label={interactionLocked ? "请求处理中，请等待完成" : undefined}>
                <button
                  type="button"
                  disabled={interactionLocked}
                  className={buttonClass("secondary", "xs")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChat?.(item.id);
                  }}
                >
                  继续询问
                </button>
              </Tooltip>
              <Tooltip label={interactionLocked ? "请求处理中，请等待完成" : undefined}>
                <button
                  type="button"
                  disabled={applyingOpinion || interactionLocked}
                  className={buttonClass("primary", "xs")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onApplyOpinion?.(item.id);
                  }}
                >
                  {applyingOpinion ? "生成中…" : "按此意见修改"}
                </button>
              </Tooltip>
            </>
          )}

          {visualRevertible && (
            <Tooltip label={interactionLocked ? "请求处理中，请等待完成" : undefined}>
              <button
                type="button"
                disabled={interactionLocked}
                className={buttonClass("secondary", "xs")}
                onClick={(e) => {
                  e.stopPropagation();
                  onRevert(item.id);
                }}
              >
                撤销
              </button>
            </Tooltip>
          )}

          {visualStatus === "stale" && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              原文已变化，无法定位
            </span>
          )}
        </div>
      </article>
    </li>
  );
}
