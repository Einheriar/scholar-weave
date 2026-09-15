"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * 自定义下拉选择器：原生 <select> 的展开面板由系统渲染、无法定制样式，
 * 这里用按钮 + 浮层面板实现，风格与应用设计令牌一致（圆角、绿色选中态）。
 * 支持：点击外部关闭、Esc 关闭、上下方向键 + Enter 选择。
 *
 * 面板通过 portal 挂到 body 并用 fixed 定位：设置面板的正文是 overflow-y-auto
 * 的滚动容器，绝对定位的面板会被它裁掉（底部的「思考档位」尤其明显），
 * 因此脱离文档流，并且下方空间不足时自动向上翻转。
 */

export type SelectOption = { value: string; label: string };

const GAP = 4;
const PANEL_MAX_H = 240;

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
  const [rect, setRect] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLUListElement>(null);

  const current = options.find((o) => o.value === value);

  // 打开下拉时同步高亮到当前选中项（渲染期 derived-state，避免 effect 内 setState）
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setActiveIndex(Math.max(0, options.findIndex((o) => o.value === value)));
    }
  }

  /** 按触发按钮的位置算出浮层坐标，下方放不下就往上翻 */
  const updatePosition = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom - GAP;
    const spaceAbove = r.top - GAP;
    const flipUp = spaceBelow < PANEL_MAX_H && spaceAbove > spaceBelow;
    // 浮层宽度不小于按钮宽度，也不能窄于最长选项的文本（避免 "SOCKS5" 被截断）
    const longest = options.reduce(
      (max, o) => Math.max(max, o.label.length),
      0,
    );
    const estMinWidth = longest * 8 + 40; // ~8px/字符 + padding + 选中勾
    setRect({
      left: r.left,
      width: Math.max(r.width, estMinWidth),
      ...(flipUp
        ? { bottom: window.innerHeight - r.top + GAP }
        : { top: r.bottom + GAP }),
    });
  }, [options]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  // 点击外部关闭（面板已 portal 出去，两个 ref 都要判断）
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // 滚动/缩放时跟随（面板 fixed 定位，不跟随就会与按钮错位）
  useEffect(() => {
    if (!open) return;
    const onReflow = () => updatePosition();
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [open, updatePosition]);

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

      {open &&
        rect &&
        createPortal(
          <ul
            ref={panelRef}
            role="listbox"
            aria-label={ariaLabel}
            style={{
              left: rect.left,
              width: rect.width,
              maxHeight: PANEL_MAX_H,
              ...(rect.top !== undefined ? { top: rect.top } : {}),
              ...(rect.bottom !== undefined ? { bottom: rect.bottom } : {}),
            }}
            className="animate-item-in fixed z-[200] overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-lg"
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
          </ul>,
          document.body,
        )}
    </div>
  );
}
