"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 自定义下拉选择器：原生 <select> 的展开面板由系统渲染、无法定制样式，
 * 这里用按钮 + 绝对定位面板实现，风格与应用设计令牌一致（圆角、绿色选中态）。
 * 支持：点击外部关闭、Esc 关闭、上下方向键 + Enter 选择。
 */

export type SelectOption = { value: string; label: string };

export function Select({
  value,
  onChange,
  options,
  ariaLabel,
  className = "",
  size = "md",
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  ariaLabel: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const current = options.find((o) => o.value === value);

  // 打开下拉时同步高亮到当前选中项（渲染期 derived-state，避免 effect 内 setState）
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setActiveIndex(Math.max(0, options.findIndex((o) => o.value === value)));
    }
  }

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const commit = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const opt = options[activeIndex];
      if (opt) commit(opt.value);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const pad = size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm";

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        className={`flex w-full items-center justify-between gap-1.5 rounded-lg border border-border bg-surface font-medium text-foreground shadow-sm transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring ${pad}`}
      >
        <span className="truncate">{current?.label ?? value}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={`shrink-0 text-text-faint transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel}
          className="animate-item-in absolute left-0 top-full z-50 mt-1 max-h-60 min-w-full overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-lg"
        >
          {options.map((opt, i) => {
            const selected = opt.value === value;
            return (
              <li key={opt.value} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => commit(opt.value)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={
                    `flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors ${size === "sm" ? "text-xs" : "text-sm"} ` +
                    (selected
                      ? "bg-brand-soft font-medium text-brand"
                      : i === activeIndex
                        ? "bg-surface-muted text-foreground"
                        : "text-foreground")
                  }
                >
                  <span className="truncate">{opt.label}</span>
                  {selected && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
