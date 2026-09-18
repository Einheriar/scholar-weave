"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatNode } from "@/lib/review-schema";
import {
  deriveNodeTitle,
  VIRTUAL_DOCUMENT_NODE_ID,
} from "@/lib/chat-nodes";
import { Tooltip } from "@/components/ui/tooltip";

export type NodeTimelineProps = {
  nodes: ChatNode[];
  /** 当前查看的节点 id（当前节点行高亮，规则 18） */
  activeNodeId: string | null;
  /** 当前是否正在查看固定全文节点（包括尚未持久化的虚拟入口）。 */
  documentContextActive: boolean;
  /** 当前无法可靠定位到正文的节点 id */
  staleNodeIds: ReadonlySet<string>;
  /** stale 节点中因重复文本无法唯一消歧的节点 id */
  ambiguousNodeIds: ReadonlySet<string>;
  /** 点击端点：切到该节点并滚动到对应轮次（规则 19） */
  onJump: (nodeId: string, turnIndex: number) => void;
  /** 点击节点身份竖条：切到并定位该节点的正文锚点 */
  onRevealAnchor: (nodeId: string) => void;
  /** 点击固定全文入口：切换到全文聊天，不要求它已经产生过消息。 */
  onSelectDocument: () => void;
  /** 行内删除该节点全部讨论（规则 13，直接删不弹确认） */
  onDeleteNode: (nodeId: string) => void;
  onClose: () => void;
  /** 正在播退出动画：换用 -closing 关键帧，播完由 onClosingEnd 通知父组件收尾（约定 8/15） */
  closing: boolean;
  onClosingEnd: () => void;
};

type HoverInfo = { row: number; node: ChatNode; content: string };

/** 端点（= 一次提问）在尺子上的固定横向间距 px——端点像刻度一样从左往右排，间距不随提问数变化 */
const TICK_GAP = 26;
/** hover 两端箭头时尺子卷动的像素/帧 */
const PAN_STEP = 2;

/**
 * 节点时间线抽屉（规则 14-19）：一条横线 = 一个节点，线上端点 = 一次提问，
 * 多条线并列 = 多个节点。不常驻界面，是「地图 / 目录」。
 * 从聊天区顶部向上抽出、与聊天区外壳连成一体的抽屉（不是屏幕居中弹窗）：
 * 底部衔接聊天区头部、往上展开，点击外部收起。行内不带常驻摘要文字；
 * hover 端点即时浮出锚点摘要 + 该次提问内容（规则 16）；按节点创建时间排序。
 *
 * 端点排布：左对齐、固定间距（TICK_GAP），像尺子刻度一样从起点往右累加——
 * 不用百分比摊匀（摊匀会让端点位置随提问数乱变，1 问居中、2 问挤两头，反直觉）。
 * 端点太多放不下时，两端出现 hover 卷轴箭头，悬停即平滑卷动整条尺子。
 */
export function NodeTimeline({
  nodes,
  activeNodeId,
  documentContextActive,
  staleNodeIds,
  ambiguousNodeIds,
  onJump,
  onRevealAnchor,
  onSelectDocument,
  onDeleteNode,
  onClose,
  closing,
  onClosingEnd,
}: NodeTimelineProps) {
  // 当前 hover 的端点：{row 行索引, 摘要内容}，驱动悬浮 tooltip 与行联动高亮
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  // closing 时把进入动画换成退出动画（互斥，不叠加——两个 both 填充的动画同时
  // 设置 transform/transform-origin 会互相干扰，抽屉会卡在半透明的鬼影态）。
  // 直接同步切换 class：进入和退出的 scale 都只差 3%，从中途切换的轻微回跳肉眼
  // 几乎不可察觉，不值得为此引入 rAF（后台标签会冻结 rAF，反而把退出类卡丢）。
  useEffect(() => {
    const el = drawerRef.current;
    if (!el) return;
    if (closing) {
      el.classList.remove("animate-timeline-dropdown");
      el.classList.add("animate-timeline-dropdown-closing");
    } else {
      el.classList.remove("animate-timeline-dropdown-closing");
      el.classList.add("animate-timeline-dropdown");
    }
  }, [closing]);

  // Escape 关闭（可访问性）。不做自动聚焦/焦点归还：抽屉由头部按钮 toggle 开合，
  // 强行移动焦点反而会在「再按一次按钮收起」时抢焦点。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 全文入口固定第一行。没有真实 document 节点时只构造界面虚拟项，首次发送才落库。
  const persistedDocument =
    nodes.find((node) => node.anchor.type === "document") ?? null;
  const documentEntry: ChatNode = persistedDocument ?? {
    id: VIRTUAL_DOCUMENT_NODE_ID,
    anchor: { type: "document" },
    originalText: "",
    createdAt: "",
    turns: [],
  };
  // 其余局部节点仍按创建时间排序（规则 17）
  const sorted = nodes
    .filter((node) => node.anchor.type !== "document")
    .sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
  );

  const showTip = (row: number, node: ChatNode, content: string) =>
    setHover({ row, node, content });

  return (
    // 抽屉与聊天区连成一体：聊天区顶部圆角让位给抽屉（见 ContextChat 的 rounded 切换），
    // 抽屉 bottom-full 贴住聊天区上沿往上展开、共享聊天区边框（无边缝线）。
    // 头部「聊天节点历史」按钮是 toggle，再按一次收起。
    <div
      ref={drawerRef}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="absolute inset-x-0 bottom-full z-30 max-h-[42vh] overflow-y-auto rounded-t-2xl border border-border bg-surface shadow-[0_-10px_24px_-14px_rgb(0_0_0/0.28)] animate-timeline-dropdown"
      onAnimationEnd={(e) => {
        // 只认退出动画结束、且是本层（不是冒泡上来的子元素动画）才收尾。
        // reduced-motion 下 animation: none 不会有这个事件，由父组件同步收尾。
        if (
          closing &&
          e.target === e.currentTarget &&
          e.animationName === "timeline-dropdown-out"
        ) {
          onClosingEnd();
        }
      }}
      role="dialog"
      aria-label="聊天节点历史"
    >
      <div>
        {/* 标题行：与列表之间不要分割线（抽屉与聊天区已一体，再切一刀是多余的） */}
        <div className="sticky top-0 flex items-center justify-between bg-surface px-4 pt-2.5 pb-1">
          <h2 className="text-xs font-semibold tracking-tight text-text-muted">
            聊天节点
          </h2>
          <Tooltip label="收起节点时间线" side="left">
            <button
              type="button"
              onClick={onClose}
              aria-label="收起节点时间线"
              className="rounded-md p-1 text-text-faint transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </Tooltip>
        </div>

        <ul className="space-y-1 p-2">
          <NodeRow
            node={documentEntry}
            isActive={documentContextActive}
            anchorStale={false}
            anchorAmbiguous={false}
            dimmed={hover !== null && hover.row !== 0}
            lit={hover?.row === 0}
            onShowTip={(content) => showTip(0, documentEntry, content)}
            onHideTip={() => setHover(null)}
            onJump={onJump}
            onRevealAnchor={onRevealAnchor}
            onSelectDocument={onSelectDocument}
            onDeleteNode={onDeleteNode}
          />
          {sorted.map((node, row) => (
            <NodeRow
              key={node.id}
              node={node}
              isActive={node.id === activeNodeId}
              anchorStale={staleNodeIds.has(node.id)}
              anchorAmbiguous={ambiguousNodeIds.has(node.id)}
              dimmed={hover !== null && hover.row !== row + 1}
              lit={hover?.row === row + 1}
              onShowTip={(content) => showTip(row + 1, node, content)}
              onHideTip={() => setHover(null)}
              onJump={onJump}
              onRevealAnchor={onRevealAnchor}
              onSelectDocument={onSelectDocument}
              onDeleteNode={onDeleteNode}
            />
          ))}
        </ul>

        {/* hover 端点悬浮摘要（规则 16）：锚点摘要 + 该次提问内容截断，即时出现。
            绝对定位悬浮层、顶到与标题行同一高度，不压任何节点行；脱离文档流——
            放进流内会把行撑开、端点位移、hover 循环闪烁（踩过的坑）。
            pointer-events-none 保证鼠标穿过它。 */}
        {hover && (
          <div
            role="tooltip"
            className="pointer-events-none absolute left-3 top-1.5 z-10 w-fit max-w-[calc(100%-3.5rem)] animate-tooltip-rise rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs shadow-md"
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

/** 单行：节点身份竖条 + 尺子轨道（端点 = 提问，左对齐固定间距，溢出两端 hover 卷轴）+ N 问 + 删除 */
function NodeRow({
  node,
  isActive,
  anchorStale,
  anchorAmbiguous,
  dimmed,
  lit,
  onShowTip,
  onHideTip,
  onJump,
  onRevealAnchor,
  onSelectDocument,
  onDeleteNode,
}: {
  node: ChatNode;
  isActive: boolean;
  anchorStale: boolean;
  anchorAmbiguous: boolean;
  /** 其它行正被 hover：本行压暗，突出焦点那行 */
  dimmed: boolean;
  /** 本行正被 hover（端点上）：提亮 */
  lit: boolean;
  onShowTip: (content: string) => void;
  onHideTip: () => void;
  onJump: (nodeId: string, turnIndex: number) => void;
  onRevealAnchor: (nodeId: string) => void;
  onSelectDocument: () => void;
  onDeleteNode: (nodeId: string) => void;
}) {
  const turns = node.turns;
  const userTurns = turns
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.role === "user");
  const userTurnCount = userTurns.length;
  const nodeTitle = deriveNodeTitle(node);
  const isDocument = node.anchor.type === "document";

  // 尺子卷轴：scrollLeft 状态驱动两端箭头显隐
  const rulerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const panRef = useRef<number | null>(null);

  const syncArrows = () => {
    const el = rulerRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 1);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };
  // 挂载与端点数变化时量一次（内容超宽才可能有箭头）
  useEffect(() => {
    syncArrows();
    const el = rulerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(syncArrows);
    ro.observe(el);
    return () => ro.disconnect();
  }, [userTurnCount]);

  // 悬停箭头 → 持续卷动尺子（rAF 循环），移开即停
  const startPan = (dir: 1 | -1) => {
    stopPan();
    const step = () => {
      const el = rulerRef.current;
      if (!el) return;
      el.scrollLeft += dir * PAN_STEP;
      panRef.current = requestAnimationFrame(step);
    };
    panRef.current = requestAnimationFrame(step);
  };
  const stopPan = () => {
    if (panRef.current !== null) cancelAnimationFrame(panRef.current);
    panRef.current = null;
  };
  useEffect(() => stopPan, []);

  const rowBg = isActive ? "bg-node-soft" : "";
  const rowHover = isActive
    ? "hover:bg-[color-mix(in_srgb,var(--node)_18%,var(--surface))]"
    : "hover:bg-node-soft";
  return (
    <li
      className={
        "flex items-center gap-1 rounded-lg px-3 py-1.5 transition-all duration-200 " +
        rowBg +
        " " +
        (lit || isActive ? rowHover : "") +
        (dimmed ? " opacity-60" : "")
      }
    >
      {/* 节点身份竖条仍是次要入口：视觉保持 3px，仅把命中区温和扩到 12×24px。
          它与轨道端点语义分工：竖条回正文，端点跳某次提问。 */}
      {isDocument ? (
        <Tooltip label="切换到全文节点">
          <button
            type="button"
            onClick={onSelectDocument}
            aria-label="切换到全文节点"
            data-node-identity="document"
            className={
              "-my-1 inline-flex h-6 w-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold text-node transition-colors hover:text-node-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-node-ring " +
              (isActive ? "text-node-hover" : "")
            }
          >
            全文
          </button>
        </Tooltip>
      ) : (
        <Tooltip
          label={
            anchorStale
              ? anchorAmbiguous
                ? "无法唯一确定原选区"
                : "原文已变更，无法定位"
              : "定位到正文锚点"
          }
        >
          <button
            type="button"
            disabled={anchorStale}
            onClick={() => onRevealAnchor(node.id)}
            aria-label={`定位到节点「${nodeTitle}」的正文锚点`}
            data-node-identity="local"
            className={
              "group -my-1 flex h-6 w-8 shrink-0 items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-node-ring " +
              (anchorStale ? "cursor-default opacity-45" : "cursor-pointer")
            }
          >
            <span
              data-node-marker
              className={
                "h-4 w-[3px] rounded-full transition-all duration-150 " +
                (isActive ? "bg-node-hover" : "bg-node") +
                (anchorStale ? "" : " group-hover:w-[5px]")
              }
              aria-hidden
            />
          </button>
        </Tooltip>
      )}

      {/* 尺子轨道：横向可滚，端点左对齐固定间距；scrollbar 隐藏，靠两端箭头卷动 */}
      <div data-node-ruler className="relative min-w-16 flex-1">
        <div
          ref={rulerRef}
          onScroll={syncArrows}
          className="timeline-ruler overflow-x-auto overflow-y-hidden"
        >
          {/* 轨道线拉满内容宽度，端点按刻度依次排列 */}
          <div
            className="relative h-4"
            style={{ width: Math.max(48, userTurnCount * TICK_GAP + 32) }}
          >
            <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-border-strong" />
            {userTurns.map(({ t, i }, k) => (
              <button
                key={i}
                type="button"
                onClick={() => onJump(node.id, i)}
                onMouseEnter={() => onShowTip(t.content)}
                onMouseLeave={onHideTip}
                onFocus={() => onShowTip(t.content)}
                onBlur={onHideTip}
                aria-label={`跳到节点「${nodeTitle}」第 ${k + 1} 次提问：${t.content}`}
                className={
                  "absolute top-1/2 h-2 w-2 -translate-y-1/2 cursor-pointer rounded-full transition-all duration-150 focus-visible:outline-none " +
                  (isActive ? "bg-node-hover" : "bg-node") +
                  " hover:scale-150 hover:shadow-[0_0_0_4px_var(--node-soft),0_0_10px_2px_var(--node-ring)] focus-visible:scale-150 focus-visible:shadow-[0_0_0_4px_var(--node-soft),0_0_10px_2px_var(--node-ring)]"
                }
                style={{ left: 16 + k * TICK_GAP }}
              />
            ))}
          </div>
        </div>

        {/* 左卷轴箭头：有内容被卷到左边时出现，悬停持续回卷 */}
        {canLeft && (
          <PanArrow dir={-1} onEnter={() => startPan(-1)} onLeave={stopPan} />
        )}
        {/* 右卷轴箭头：后面还有端点时出现，悬停持续前卷 */}
        {canRight && (
          <PanArrow dir={1} onEnter={() => startPan(1)} onLeave={stopPan} />
        )}
      </div>

      <span className="shrink-0 text-[11px] tabular-nums text-text-faint">
        {userTurnCount} 问
      </span>
      {/* 固定全文入口不会消失：有讨论时这里只清空内容；0 问时不显示清空键。 */}
      {(!isDocument || userTurnCount > 0) && (
        <Tooltip
          label={isDocument ? "清空全文节点讨论" : "删除该节点讨论"}
          side="left"
        >
          <button
            type="button"
            onClick={() => onDeleteNode(node.id)}
            aria-label={isDocument ? "清空全文节点讨论" : "删除该节点讨论"}
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
        </Tooltip>
      )}
    </li>
  );
}

/** 尺子两端的 hover 卷轴箭头：悬停即让整条尺子平滑卷动，移开即停。只响应 hover，不是按钮（不可点）。 */
function PanArrow({
  dir,
  onEnter,
  onLeave,
}: {
  dir: 1 | -1;
  onEnter: () => void;
  onLeave: () => void;
}) {
  return (
    <span
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      aria-hidden
      className={
        "absolute top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 cursor-default items-center justify-center text-node transition-opacity " +
        (dir === 1 ? "right-0" : "left-0")
      }
      style={{
        // 渐入的遮罩，让端点卷到边缘时淡出而不是硬切
        background:
          dir === 1
            ? "linear-gradient(to right, transparent, var(--surface) 60%)"
            : "linear-gradient(to left, transparent, var(--surface) 60%)",
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        {dir === 1 ? <polyline points="9 18 15 12 9 6" /> : <polyline points="15 18 9 12 15 6" />}
      </svg>
    </span>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
