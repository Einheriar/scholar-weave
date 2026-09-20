"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LLMPreset } from "@/lib/settings";

type ModelList = { connection: string; models: string[]; error?: string };

/** A free-form model ID input with provider-sourced, locally filtered suggestions. */
export function ModelInput({ preset, onChange, className }: {
  preset: LLMPreset;
  onChange: (value: string) => void;
  className: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<ModelList | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [rect, setRect] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  // The model and reasoning fields do not affect the provider's model catalogue.
  const connection = JSON.stringify({
    apiKey: preset.apiKey.trim(),
    baseURL: preset.baseURL.trim(),
    ...(preset.proxy.enabled ? {
      proxy: { type: preset.proxy.type, host: preset.proxy.host, port: preset.proxy.port },
    } : {}),
  });
  const current = result?.connection === connection ? result : null;
  const query = preset.model.trim().toLowerCase();
  const matches = (current?.models ?? []).filter((id) => id.toLowerCase().includes(query))
    .sort((a, b) => Number(b.toLowerCase().startsWith(query)) - Number(a.toLowerCase().startsWith(query)) || a.localeCompare(b));
  const options = matches.slice(0, 50);
  const activeIndex = options.indexOf(activeId ?? "");

  useEffect(() => {
    if (!requested) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: connection,
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok || !Array.isArray(body.models) || !body.models.every((id: unknown) => typeof id === "string")) {
          throw new Error("无法获取模型列表，可手动输入模型名称。");
        }
        if (!controller.signal.aborted) {
          setResult({ connection, models: [...new Set<string>(body.models)] });
        }
      } catch {
        if (!controller.signal.aborted) {
          setResult({ connection, models: [], error: "无法获取模型列表，可手动输入模型名称。" });
        }
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [connection, requested, retry]);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const bounds = inputRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const below = window.innerHeight - bounds.bottom - 12;
      const above = bounds.top - 12;
      const up = below < 260 && above > below;
      setRect({
        left: Math.max(8, Math.min(bounds.left, window.innerWidth - bounds.width - 8)),
        width: Math.min(bounds.width, window.innerWidth - 16),
        maxHeight: Math.max(80, Math.min(280, up ? above : below)),
        ...(up ? { bottom: window.innerHeight - bounds.top + 4 } : { top: bounds.bottom + 4 }),
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (open && activeIndex >= 0) {
      panelRef.current?.querySelectorAll('[role="option"]')[activeIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [open, activeIndex]);

  const show = () => { setOpen(true); setRequested(true); };
  const choose = (id: string) => { onChange(id); setOpen(false); setActiveId(null); };

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label="模型"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        value={preset.model}
        placeholder="deepseek-chat"
        autoComplete="off"
        spellCheck={false}
        className={className}
        onFocus={show}
        onClick={show}
        onBlur={() => { setOpen(false); setActiveId(null); }}
        onChange={(event) => { onChange(event.target.value); setActiveId(null); show(); }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            setActiveId(null);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            show();
            const index = event.key === "ArrowDown"
              ? Math.min(options.length - 1, activeIndex + 1)
              : activeIndex < 0 ? options.length - 1 : Math.max(0, activeIndex - 1);
            setActiveId(options[index] ?? null);
          } else if (event.key === "Enter" && open && activeIndex >= 0) {
            event.preventDefault();
            choose(options[activeIndex]);
          } else if (event.key === "Tab") {
            setOpen(false);
          }
        }}
      />
      {open && rect && createPortal(
        <div
          ref={panelRef}
          style={rect}
          className="fixed z-[200] overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-lg"
          onMouseDown={(event) => event.preventDefault()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <div role="listbox" id={listId} aria-label="模型建议">
            {options.map((id, index) => (
              <div
                key={id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={id === activeId}
                onMouseEnter={() => setActiveId(id)}
                onClick={() => choose(id)}
                className={`cursor-pointer break-words rounded-lg px-2.5 py-2 text-sm ${id === activeId ? "bg-brand-soft text-brand" : "text-foreground hover:bg-surface-muted"}`}
              >{id}</div>
            ))}
          </div>
          {(!current || current.error || !options.length || matches.length > 50) && (
            <p role="status" className="px-2.5 py-2 text-xs text-text-muted">
              {!current ? "正在获取模型列表…" : current.error ?? (matches.length > 50
                ? "显示前 50 项，请继续输入筛选。"
                : current.models.length ? "没有匹配的模型，可继续手动输入。" : "提供商未返回模型，可手动输入模型名称。")}
            </p>
          )}
          {current?.error && (
            <button
              type="button"
              onClick={() => { setResult(null); setRetry((value) => value + 1); }}
              className="mx-2.5 mb-2 rounded px-1 text-xs text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            >重新获取</button>
          )}
        </div>, document.body,
      )}
    </>
  );
}
