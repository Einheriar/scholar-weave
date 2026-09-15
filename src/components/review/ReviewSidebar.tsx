"use client";

import { useMemo, useState } from "react";
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
  onApplyOpinion?: (id: string) => void;
  applyingOpinionId?: string | null;
};

/**
 * 审阅侧栏（PLAN 6.1 / 6.3）。
 * 按范围分三区（全文 / 段落 / 局部），并支持按 范围/类型/类别/状态 筛选。
 * 范围筛选用胶囊按钮组（Grammarly 式一键切换），其余维度用下拉。
 */
export function ReviewSidebar({
  items,
  selectedId,
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

      <div className="flex-1 space-y-5 overflow-y-auto p-3">
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
