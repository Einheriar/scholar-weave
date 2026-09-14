import type {
  ReviewCategory,
  ReviewItem,
  ReviewStatus,
} from "@/lib/review-schema";

/** 类别与状态的展示元信息：颜色 + 图标 + 中文标签（颜色不单独作为信息载体，PLAN 6.2） */

export const CATEGORY_META: Record<
  ReviewCategory,
  { label: string; icon: string; textClass: string }
> = {
  grammar: { label: "语法", icon: "✎", textClass: "text-red-600" },
  clarity: { label: "清晰度", icon: "◎", textClass: "text-blue-600" },
  style: { label: "风格", icon: "❖", textClass: "text-violet-600" },
  structure: { label: "结构", icon: "▤", textClass: "text-cyan-600" },
  logic: { label: "逻辑", icon: "⇄", textClass: "text-orange-600" },
  consistency: { label: "一致性", icon: "≋", textClass: "text-lime-600" },
};

export const STATUS_META: Record<ReviewStatus, { label: string; className: string }> =
  {
    open: { label: "待处理", className: "bg-neutral-100 text-neutral-600" },
    accepted: { label: "已接受", className: "bg-green-100 text-green-700" },
    rejected: { label: "已忽略", className: "bg-neutral-100 text-neutral-400" },
    stale: { label: "已过期", className: "bg-amber-100 text-amber-700" },
  };

export const SEVERITY_META: Record<
  ReviewItem["severity"],
  { label: string; className: string }
> = {
  info: { label: "提示", className: "text-neutral-500" },
  suggestion: { label: "建议", className: "text-blue-600" },
  important: { label: "重要", className: "text-red-600 font-medium" },
};

export const KIND_LABEL: Record<ReviewItem["kind"], string> = {
  opinion: "审阅意见",
  edit: "具体修改",
};

export const SCOPE_LABEL: Record<ReviewItem["scope"]["type"], string> = {
  document: "全文",
  block: "段落",
  range: "局部",
};
