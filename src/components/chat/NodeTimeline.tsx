"use client";

import { useEffect, useRef } from "react";
import type { ChatNode } from "@/lib/review-schema";
import { deriveNodeTitle } from "@/lib/chat-nodes";

export type NodeTimelineProps = {
  nodes: ChatNode[];
  /** 当前查看的节点 id（当前节点行高亮，规则 18） */
  activeNodeId: string | null;
  /** 点击端点：切到该节点并滚动到对应轮次（规则 19） */
  onJump: (nodeId: string, turnIndex: number) => void;
  /** 行内删除该节点全部讨论（规则 13，直接删不弹确认） */
  onDeleteNode: (nodeId: string) => void;
  onClose: () => void;
};

/**
 * 节点时间线抽屉（规则 14-19）：一条横线 = 一个节点，线上端点 = 一次提问，
 * 多条线并列 = 多个节点。不常驻界面，是「地图 / 目录」。
 * 从聊天区顶部向上抽出的抽屉（不是屏幕居中弹窗）：底部衔接聊天区头部、往上展开，
 * 点击外部收起。行内不带摘要文字；hover 端点悬浮锚点摘要；按节点创建时间排序。
 */
export function NodeTimeline({
  nodes,
  activeNodeId,
  onJump,
  onDeleteNode,
  onClose,
}: NodeTimelineProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape 关闭 + 焦点进入弹层（可访问性）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  // 按节点创建时间排序（规则 17）
  const sorted = [...nodes].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
  );

  return (
    // 从聊天区顶部向上抽出的抽屉：absolute 定位于聊天区容器（ContextChat section 是 relative），
    // bottom-full 贴住聊天区上沿往上展开。点抽屉外部（聊天区其余区域）收起。
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="absolute inset-x-0 bottom-full z-30 max-h-[46vh] overflow-y-auto rounded-t-2xl border border-b-0 border-border bg-surface shadow-lg animate-timeline-rise"
      role="dialog"
      aria-label="聊天节点历史"
    >
      <div ref={panelRef}>
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-surface px-4 py-2.5">
          <h2 className="text-xs font-semibold tracking-tight text-text-muted">
            聊天节点
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-1.5 py-0.5 text-text-faint transition-colors hover:bg-surface-muted hover:text-foreground"
          >
            关闭
          </button>
        </div>

        <ul className="space-y-1 p-2">
          {sorted.length === 0 && (
            <li className="px-3 py-4 text-xs leading-relaxed text-text-faint">
              还没有聊天节点。选中正文里的词或段落提问后，这里会出现对应的讨论线。
            </li>
          )}
          {sorted.map((node) => {
            const isActive = node.id === activeNodeId;
            const turns = node.turns;
            const userTurnCount = turns.filter((t) => t.role === "user").length;
            return (
              <li
                key={node.id}
                className={
                  "flex items-center gap-2 rounded-lg px-3 py-2 " +
                  (isActive ? "bg-brand-soft" : "hover:bg-surface-muted")
                }
              >
                {/* 节点色圆点（品牌绿；当前节点深一号） */}
                <span
                  className={
                    "h-1.5 w-1.5 shrink-0 rounded-full " +
                    (isActive ? "bg-brand-hover" : "bg-brand")
                  }
                  aria-hidden
                />
                {/* 横线轨道 + 端点（端点 = 提问，颜色同节点色，沿轨道均匀分布） */}
                <div className="relative h-0.5 min-w-16 flex-1 rounded-full bg-border-strong">
                  {turns.map((t, i) => {
                    // 只给用户提问画端点；均匀分布在轨道上
                    if (t.role !== "user") return null;
                    const userIdx = turns
                      .slice(0, i + 1)
                      .filter((x) => x.role === "user").length;
                    const total = Math.max(1, userTurnCount);
                    const left = total === 1 ? 50 : (userIdx - 1) * (100 / (total - 1));
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => onJump(node.id, i)}
                        title={deriveNodeTitle(node)}
                        aria-label={`跳到节点「${deriveNodeTitle(node)}」第 ${userIdx} 次提问`}
                        className={
                          "absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform hover:scale-125 " +
                          (isActive ? "bg-brand-hover" : "bg-brand")
                        }
                        style={{ left: `${left}%` }}
                      />
                    );
                  })}
                </div>
                <span className="shrink-0 text-[11px] text-text-faint">
                  {userTurnCount} 问
                </span>
                {/* 行内删除（规则 13：删该行全部讨论，直接删不弹确认） */}
                <button
                  type="button"
                  onClick={() => onDeleteNode(node.id)}
                  aria-label="删除该节点讨论"
                  title="删除该节点讨论"
                  className="shrink-0 rounded-md p-1 text-text-faint transition-colors hover:bg-surface hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring dark:hover:text-red-400"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
