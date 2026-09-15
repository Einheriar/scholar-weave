"use client";

import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";

/**
 * 深浅色切换按钮。主题状态本体是 <html> 上的 .dark class（外部可变状态），
 * 偏好持久化在 localStorage["theme"]，layout 的内联脚本在首帧前恢复它。
 * 用 useSyncExternalStore 订阅 class 变化：服务端按浅色渲染、hydration 后与
 * DOM 对齐，不会产生 hydration 不匹配。
 */

const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function getSnapshot() {
  return document.documentElement.classList.contains("dark");
}
function getServerSnapshot() {
  return false; // 默认浅色，与 SSR 渲染一致
}

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useLayoutEffect(() => {
    // dev 下 StrictMode 重挂载会清掉 <html> 上由内联脚本加的 class，这里按
    // 持久化偏好重新应用（paint 前执行，无闪烁；生产环境为 no-op）
    const isDark = (() => {
      try {
        return localStorage.getItem("theme") === "dark";
      } catch {
        return false;
      }
    })();
    const el = document.documentElement;
    if (el.classList.contains("dark") !== isDark) {
      el.classList.toggle("dark", isDark);
      emit();
    }
  }, []);

  const toggle = useCallback(() => {
    const next = !getSnapshot();
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // localStorage 不可用时仅本次会话生效
    }
    emit();
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={dark}
      title={dark ? "切换到浅色模式" : "切换到深色模式"}
      className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      {dark ? "切换浅色" : "切换深色"}
    </button>
  );
}
