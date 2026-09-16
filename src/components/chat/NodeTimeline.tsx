"use client";

import { useEffect, useRef, useState } from "react";
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

type HoverInfo = { row: number; node: ChatNode; content: string };

/**
 * 节点时间线抽屉（规则 14-19）：一条横线 = 一个节点，线上端点 = 一次提问，
 * 多条线并列 = 多个节点。不常驻界面，是「地图 / 目录」。
 * 从聊天区顶部向上抽出、与聊天区外壳连成一体的抽屉（不是屏幕居中弹窗）：
 * 底部衔接聊天区头部、往上展开，点击外部收起。行内不带常驻摘要文字；
 * hover 端点即时浮出锚点摘要 + 该次提问内容（规则 16）；按节点创建时间排序。
 */
export function NodeTimeline({
  nodes,
  activeNodeId,
  onJump,
  onDeleteNode,
  onClose,
}: NodeTimelineProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // 当前 hover 的端点：{row 行索引, 摘要内容}，驱动悬浮 tooltip 与行联动高亮
  const [hover, setHover] = useState<HoverInfo | null>(null);

  // Escape 关闭（可访问性）。不做自动聚焦/焦点归还：抽屉由头部按钮 toggle 开合，
  // 强行移动焦点反而会在「再按一次按钮收起」时抢焦点。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 按节点创建时间排序（规则 17）
  const sorted = [...nodes].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
  );

  const showTip = (row: number, node: ChatNode, content: string) =>
    setHover({ row, node, content });

  return (
    // 抽屉与聊天区连成一体：聊天区顶部圆角让位给抽屉（见 ContextChat 的 rounded 切换），
    // 抽屉 bottom-full 贴住聊天区上沿往上展开、共享聊天区边框（无边缝线）。
    // 头部「聊天节点历史」按钮是 toggle，再按一次收起。
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
            className="absolute inset-x-0 bottom-full z-30 max-h-[42vh] overflow-y-auto rounded-t-2xl border border-border bg-surface shadow-[0_-10px_24px_-14px_rgb(0_0_0/0.28)] animate-timeline-rise"
      role="dialog"
      aria-label="聊天节点历史"
    >
      <div ref={panelRef}>
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-surface px-4 py-2">
          <h2 className="text-xs font-semibold tracking-tight text-text-muted">
            聊天节点
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="收起节点时间线"
            title="收起节点时间线"
            className="rounded-md p-1 text-text-faint transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <ul className="space-y-1 p-2">
          {sorted.length === 0 && (
            <li className="px-3 py-4 text-xs leading-relaxed text-text-faint">
              还没有聊天节点。选中正文里的词或段落提问后，这里会出现对应的讨论线。
            </li>
          )}
          {sorted.map((node, row) => {
            const isActive = node.id === activeNodeId;
            const turns = node.turns;
            const userTurnCount = turns.filter((t) => t.role === "user").length;
            const nodeTitle = deriveNodeTitle(node);
            const hoverCls = isActive
              ? "hover:bg-[color-mix(in_srgb,var(--node)_18%,var(--surface))]"
              : "hover:bg-node-soft";
            return (
              <li
                key={node.id}
                className={
                  "flex items-center gap-2 rounded-lg px-3 py-1.5 transition-colors " +
                  (isActive ? "bg-node-soft " : "") +
                  (hover?.row === row || isActive ? hoverCls : "")
                }
              >
                {/* 节点身份竖条（琥珀；当前节点深一号）——竖条而非圆点，
                    与轨道上的提问端点形态区分，避免被误认成「多一次提问」 */}
                <span
                  className={
                    "h-4 w-[3px] shrink-0 rounded-full " +
                    (isActive ? "bg-node-hover" : "bg-node")
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
                        onMouseEnter={() => showTip(row, node, t.content)}
                        onMouseLeave={() => setHover(null)}
                        onFocus={() => showTip(row, node, t.content)}
                        onBlur={() => setHover(null)}
                        aria-label={`跳到节点「${nodeTitle}」第 ${userIdx} 次提问：${t.content}`}
                        className={
                          "absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full transition-all duration-150 focus-visible:outline-none " +
                          (isActive ? "bg-node-hover" : "bg-node") +
                          " hover:scale-150 hover:shadow-[0_0_0_4px_var(--node-soft),0_0_10px_2px_var(--node-ring)] focus-visible:scale-150 focus-visible:shadow-[0_0_0_4px_var(--node-soft),0_0_10px_2px_var(--node-ring)]"
                        }
                        style={{ left: `${left}%` }}
                      />
                    );
                  })}
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-text-faint">
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

        {/* hover 端点悬浮摘要（规则 16）：锚点摘要 + 该次提问内容截断，即时出现。
            绝对定位悬浮层钉在抽屉顶部（标题栏正下方），脱离文档流——若放进流内，
            出现/消失会把行撑开，端点随布局位移，鼠标离开端点又触发收起，循环闪烁。
            置顶而非置底：置底会盖住节点行。pointer-events-none 保证鼠标穿过它。 */}
        {hover && (
          <div
            role="tooltip"
            className="pointer-events-none absolute inset-x-3 top-10 z-10 w-fit max-w-full animate-tooltip-rise rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs shadow-md"
          >
            <span className="font-medium text-foreground">「{deriveNodeTitle(hover.node)}」</span>
            <span className="mx-1.5 text-text-faint" aria-hidden>·</span>
            <span className="text-text-muted">{truncate(hover.content, 48)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
