import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * 统一三级按钮样式（纯 className 工厂，不包组件，避免影响现有 aria/Tooltip 属性）。
 * primary：品牌绿主操作；secondary：白底灰边框；danger：红色边框文字；ghost：无框文字按钮。
 */

const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring disabled:opacity-40 disabled:pointer-events-none active:scale-[0.98]";

const VARIANTS = {
  primary:
    "bg-brand text-white shadow-sm hover:bg-brand-hover dark:text-neutral-950",
  secondary:
    "border border-border-strong bg-surface text-foreground hover:bg-surface-muted",
  danger:
    "border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40",
  ghost:
    "text-text-muted hover:text-foreground hover:bg-surface-muted",
} as const;

const SIZES = {
  xs: "px-2.5 py-1 text-xs",
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
} as const;

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

export function buttonClass(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "sm",
): string {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]}`;
}

/** 需要 Button 组件时的轻封装（可选使用） */
export function Button({
  variant = "secondary",
  size = "sm",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`${buttonClass(variant, size)} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
