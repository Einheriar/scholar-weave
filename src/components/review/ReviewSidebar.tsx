"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ReviewCategory,
  ReviewItem,
  ReviewStatus,
} from "@/lib/review-schema";
import { ReviewCard } from "./ReviewCard";
import { CATEGORY_META, SCOPE_LABEL, STATUS_META } from "./review-meta";
import { Select } from "@/components/ui/select";

type ScopeType = ReviewItem["scope"]["type"];
type Kind = ReviewItem["kind"];

export type ReviewSidebarProps = {
  items: ReviewItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onRevert: (id: string) => void;
  onChat?: (id: string) => void;
  /** 正文标记相对视口顶部的距离（正文→侧栏对齐用）；null 表示本次选中来自侧栏，只需滚进视野 */
  anchorTop?: number | null;
  onApplyOpinion?: (id: string) => void;
  applyingOpinionId?: string | null;
};

/**
 * 审阅侧栏（PLAN 6.1 / 6.3）。
 * 按范围分三区（全文 / 段落 / 局部），并支持按 范围/类型/类别/状态 筛选。
 * 范围筛选用胶囊按钮组（Grammarly 式一键切换），其余维度用下拉。
 */

/** 卡片对齐时与侧栏可视区上下边缘的呼吸边距（px），避免贴死边缘显得局促 */
const ALIGN_EDGE_GAP = 8;

export function ReviewSidebar({
  items,
  selectedId,
  anchorTop = null,
  onSelect,
  onAccept,
  onReject,
  onRevert,
  onChat,
  onApplyOpinion,
  applyingOpinionId = null,
}: ReviewSidebarProps) {
  const [scopeFilter, setScopeFilter] = useState<ScopeType | "all">("all");
  const [kindFilter, setKindFilter] = useState<Kind | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<ReviewCategory | "all">(
    "all",
  );
  const [statusFilter, setStatusFilter] = useState<ReviewStatus | "all">("all");

  const filtered = useMemo(
    () =>
      items.filter(
        (i) =>
          (scopeFilter === "all" || i.scope.type === scopeFilter) &&
          (kindFilter === "all" || i.kind === kindFilter) &&
          (categoryFilter === "all" || i.category === categoryFilter) &&
          (statusFilter === "all" || i.status === statusFilter),
      ),
    [items, scopeFilter, kindFilter, categoryFilter, statusFilter],
  );

  const byScope = useMemo(() => {
    const groups: Record<ScopeType, ReviewItem[]> = {
      document: [],
      block: [],
      range: [],
    };
    for (const i of filtered) groups[i.scope.type].push(i);
    return groups;
  }, [filtered]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const topSpacerRef = useRef<HTMLDivElement | null>(null);
  const bottomSpacerRef = useRef<HTMLDivElement | null>(null);
  /** 程序对齐进行中（对齐要拉进首尾补空区，钳制 effect 据此跳过） */
  const aligningRef = useRef(false);
  /** 取消正在进行的平滑对齐动画（新一次对齐/卸载时调用） */
  const cancelAlignRef = useRef<(() => void) | null>(null);

  // 选中变化时把卡片滚动到位。两种意图分开处理：
  // - 正文→侧栏（anchorTop 有值）：平滑滚动到与正文标记对齐（中心对中心，
  //   完整可见优先）。自写 rAF 插值而不用原生 smooth——后者动画期间持续位移
  //   会让 E2E「元素稳定」检查超时；自写版在测试环境/减动效下直接瞬时定位。
  // - 侧栏→正文（anchorTop 为 null）：scrollIntoView 保底，确保卡片进入可视区
  useEffect(() => {
    if (!selectedId) return;
    const scroller = scrollRef.current;
    const card = scroller?.querySelector(`[data-review-card="${selectedId}"]`);
    if (!(scroller instanceof HTMLElement) || !(card instanceof HTMLElement)) {
      return;
    }
    // 新一次对齐先取消上一次未完成的动画
    cancelAlignRef.current?.();
    cancelAlignRef.current = null;

    if (anchorTop != null) {
      const cardRect = card.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      // 理想卡片顶（相对视口）：中心对中心
      let targetCardTop = anchorTop - cardRect.height / 2;
      // 完整可见优先：顶不切头（不低过可视区上沿）、底不切尾（不高过下沿）。
      // 上下各留 ALIGN_EDGE_GAP 的呼吸边距，避免卡片贴死可视区边缘显得局促。
      targetCardTop = Math.max(targetCardTop, scrollerRect.top + ALIGN_EDGE_GAP);
      targetCardTop = Math.min(
        targetCardTop,
        scrollerRect.bottom - cardRect.height - ALIGN_EDGE_GAP,
      );
      // 目标 scrollTop = 当前 scrollTop + 卡片需移动的视口距离
      const from = scroller.scrollTop;
      const to = from + (cardRect.top - targetCardTop);

      // 测试环境（navigator.webdriver）与「减少动态效果」用户：瞬时定位，不播动画
      const reduceMotion =
        typeof window !== "undefined" &&
        (window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
          navigator.webdriver);
      const distance = Math.abs(to - from);
      if (reduceMotion || distance < 1) {
        aligningRef.current = true;
        scroller.scrollTop = to;
        requestAnimationFrame(() => { aligningRef.current = false; });
        return;
      }

      // 方案 B：短距离快、长距离封顶 750ms。每屏（clientH）约 300ms，上限 750ms。
      const duration = Math.min(750, (distance / scroller.clientHeight) * 300 + 150);
      const start = performance.now();
      let raf = 0;
      const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
      aligningRef.current = true;
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        scroller.scrollTop = from + (to - from) * easeOut(t);
        if (t < 1) {
          raf = requestAnimationFrame(step);
        } else {
          aligningRef.current = false;
          cancelAlignRef.current = null;
        }
      };
      raf = requestAnimationFrame(step);
      cancelAlignRef.current = () => {
        cancelAnimationFrame(raf);
        aligningRef.current = false;
      };
    } else {
      card.scrollIntoView({ block: "nearest" });
    }
    // 只在「选中了谁」或「正文标记位置」真正变化时对齐
  }, [selectedId, anchorTop]);

  // 卸载时取消未完成的动画
  useEffect(() => () => cancelAlignRef.current?.(), []);

  // 用户滚动钳制：首尾 80vh 补空是给「程序对齐」用的行程储备，用户滚轮**完全不该**
  // 滚进去（会对着一大片纯空白）。监听滚动，一旦越界就拉回内容区边缘。
  // aligningRef 为 true 时（程序对齐中）跳过，否则对齐永远到不了补空区。
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const clamp = () => {
      if (aligningRef.current) return;
      const top = topSpacerRef.current;
      const bottom = bottomSpacerRef.current;
      if (!top || !bottom) return; // 空态无补空，不钳制
      const clientH = scroller.clientHeight;
      const maxScroll = scroller.scrollHeight - clientH;
      // 下界：顶部补空完全不露出——第一张卡片顶到容器顶即停（minScroll = 补空高度）。
      // 之前留了 20% 过渡口子，用户仍能滚进一截空白（反馈：常看到一大块空白），收紧到 0。
      const minScroll = top.offsetHeight;
      // 上界：底部补空同理，最后一张卡片贴容器底即停。
      const maxAllowed = Math.min(
        maxScroll,
        scroller.scrollHeight - bottom.offsetHeight - clientH,
      );
      if (scroller.scrollTop < minScroll) {
        aligningRef.current = true;
        scroller.scrollTop = minScroll;
        requestAnimationFrame(() => { aligningRef.current = false; });
      } else if (scroller.scrollTop > maxAllowed) {
        aligningRef.current = true;
        scroller.scrollTop = Math.max(minScroll, maxAllowed);
        requestAnimationFrame(() => { aligningRef.current = false; });
      }
    };
    scroller.addEventListener("scroll", clamp, { passive: true });
    return () => scroller.removeEventListener("scroll", clamp);
  }, [filtered.length]);

  // 初始/筛选变化后把滚动位置钳到内容区起点（第一张卡片贴顶），
  // 否则默认 scrollTop=0 会整屏露出顶部补空（一大片空白）。
  // aligningRef 跳过：程序对齐到靠顶标记时允许短暂落在补空区。
  useEffect(() => {
    const scroller = scrollRef.current;
    const top = topSpacerRef.current;
    if (!scroller || !top) return; // 空态无补空
    if (aligningRef.current) return;
    if (scroller.scrollTop < top.offsetHeight) {
      scroller.scrollTop = top.offsetHeight;
    }
  }, [filtered.length]);

  const counts = useMemo(() => {
    const open = items.filter((i) => i.status === "open").length;
    const byScopeCount: Record<ScopeType | "all", number> = {
      all: items.length,
      document: items.filter((i) => i.scope.type === "document").length,
      block: items.filter((i) => i.scope.type === "block").length,
      range: items.filter((i) => i.scope.type === "range").length,
    };
    return { total: items.length, open, byScopeCount };
  }, [items]);

  const sections: Array<{ scope: ScopeType; title: string; empty: string }> = [
    { scope: "document", title: "全文审阅", empty: "暂无全文意见" },
    { scope: "block", title: "段落意见", empty: "暂无段落意见" },
    { scope: "range", title: "具体修改", empty: "暂无局部建议" },
  ];

  const scopeTabs: Array<{ key: ScopeType | "all"; label: string }> = [
    { key: "all", label: "全部" },
    { key: "document", label: "全文" },
    { key: "block", label: "段落" },
    { key: "range", label: "局部" },
  ];

  return (
    <aside
      className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface-muted shadow-sm"
      aria-label="审阅建议侧栏"
    >
      <div className="border-b border-border px-4 pb-3 pt-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">审阅建议</h2>
          <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand">
            {counts.open} 待处理 / 共 {counts.total}
          </span>
        </div>

        {/* 范围筛选：胶囊按钮组 */}
        <div className="mt-3 flex gap-1 rounded-xl bg-surface p-1 shadow-sm" role="group" aria-label="按范围筛选">
          {scopeTabs.map(({ key, label }) => {
            const active = scopeFilter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setScopeFilter(key)}
                aria-pressed={active}
                className={
                  "flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-all duration-150 " +
                  (active
                    ? "bg-brand text-white shadow-sm dark:text-neutral-950"
                    : "text-text-muted hover:bg-surface-muted hover:text-foreground")
                }
              >
                {label}
                <span
                  className={
                    "rounded-full px-1 text-[10px] leading-4 " +
                    (active ? "bg-white/25 dark:bg-black/15" : "bg-surface-muted text-text-faint")
                  }
                >
                  {counts.byScopeCount[key]}
                </span>
              </button>
            );
          })}
        </div>

        {/* 其余维度筛选 */}
        <div className="mt-2 grid grid-cols-3 gap-1.5 text-xs">
          <FilterSelect
            label="类型"
            value={kindFilter}
            onChange={(v) => setKindFilter(v as Kind | "all")}
            options={[
              ["all", "全部类型"],
              ["opinion", "审阅意见"],
              ["edit", "具体修改"],
            ]}
          />
          <FilterSelect
            label="类别"
            value={categoryFilter}
            onChange={(v) => setCategoryFilter(v as ReviewCategory | "all")}
            options={[
              ["all", "全部类别"],
              ...(
                Object.keys(CATEGORY_META) as ReviewCategory[]
              ).map((c): [string, string] => [c, CATEGORY_META[c].label]),
            ]}
          />
          <FilterSelect
            label="状态"
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as ReviewStatus | "all")}
            options={[
              ["all", "全部状态"],
              ...(
                Object.keys(STATUS_META) as ReviewStatus[]
              ).map((s): [string, string] => [s, STATUS_META[s].label]),
            ]}
          />
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 space-y-5 overflow-y-auto p-3"
      >
        {/*
          顶部补空：让第一张卡片也能「往上顶」到与靠顶的正文标记齐平。
          高度取侧栏可视高（约 100vh），flex-shrink-0 防止被压缩。
          只撑滚动行程，无视觉内容，aria-hidden。
          空态（无可视卡片）时不挂——否则提示文字会被推到视口外。
        */}
        {filtered.length > 0 && (
          <div ref={topSpacerRef} aria-hidden className="h-[80vh] shrink-0" />
        )}
        {filtered.length === 0 && (
          <p className="py-10 text-center text-sm text-text-faint">
            没有符合筛选条件的建议
          </p>
        )}
        {sections.map(({ scope, title, empty }) => {
          const list = byScope[scope];
          // 三个范围区始终作为 landmark 存在（无障碍分组导航）；
          // 被范围筛选排除时显示为空区，而不是整块移除。
          const excluded = scopeFilter !== "all" && scopeFilter !== scope;
          // 无筛选时 0 意见的分区整区隐藏（「没有符合筛选条件的建议」已覆盖空态），
          // 避免三个「暂无 ××」空段落刷屏；被筛选排除时仍保留空区作为 landmark。
          if (!excluded && list.length === 0 && items.length > 0) return null;
          return (
            <section key={scope} aria-label={title}>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-faint">
                <span className="inline-block h-2 w-2 rounded-full bg-border-strong" aria-hidden />
                {SCOPE_LABEL[scope]} · {title}
                <span className="font-normal">({list.length})</span>
              </h3>
              {list.length === 0 ? (
                <p className="text-xs text-text-faint">
                  {excluded ? "（当前筛选不含此范围）" : empty}
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {list.map((item) => (
                    <ReviewCard
                      key={item.id}
                      item={item}
                      selected={selectedId === item.id}
                      onSelect={onSelect}
                      onAccept={onAccept}
                      onReject={onReject}
                      onRevert={onRevert}
                      onChat={onChat}
                      onApplyOpinion={onApplyOpinion}
                      applyingOpinion={applyingOpinionId === item.id}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
        {/* 底部补空：让最后一张卡片能「往上拉」到与靠底的正文标记齐平。空态同样不挂 */}
        {filtered.length > 0 && (
          <div ref={bottomSpacerRef} aria-hidden className="h-[80vh] shrink-0" />
        )}
      </div>
    </aside>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<readonly [string, string]>;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-text-faint">{label}</span>
      <Select
        value={value}
        onChange={onChange}
        options={options.map(([v, l]) => ({ value: v, label: l }))}
        ariaLabel={`筛选${label}`}
        size="sm"
      />
    </label>
  );
}
