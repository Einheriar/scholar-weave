"use client";

import { useEffect, useRef, useState } from "react";
import type { Conversation } from "@/lib/review-schema";
import { formatRelativeTime } from "@/lib/chat-history";
import { buttonClass } from "@/components/ui/button";

/**
 * 左侧对话历史（ChatGPT 式的一条一条记录）。
 *
 * 响应式两种形态，同一个列表组件复用：
 * - 宽屏（xl 及以上）：常驻左栏，sticky 跟随滚动；
 * - 窄屏：收起，由顶栏的「三条横线」按钮拉出抽屉（遮罩 + Escape 关闭）。
 *
 * 断点用 xl（1280px）而不是 lg：主内容区在 lg 起就是 [1fr_360px] 两栏，
 * 再挤进 240px 的历史栏，编辑器会窄到不像阅读界面。xl 是能同时放下三栏的下限。
 */

export type ChatHistoryProps = {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  /** 窄屏抽屉是否展开（xl 及以上忽略） */
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type HistoryListProps = Omit<ChatHistoryProps, "open" | "onOpenChange">;

export function ChatHistory({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  open,
  onOpenChange,
}: ChatHistoryProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // 延迟卸载：closing 期间继续渲染，退出动画播完（onAnimationEnd）才真正移除。
  // {open && ...} 直接卸载会让淡出/滑出根本没机会播放（见 AGENTS.md 界面开发约定 8）。
  // closing 用「渲染期 derived state」推导：React 官方模式"渲染期间调整 state"——
  // prevOpen !== open 时在渲染体内 setState（同渲染内立即重跑，不提交中间帧）。
  const [prevOpen, setPrevOpen] = useState(open);
  const [closingDone, setClosingDone] = useState(true);
  const closing = !open && !closingDone;
  if (prevOpen !== open) {
    setPrevOpen(open);
    setClosingDone(open); // 打开时收尾；关闭时进入 closing（除非是首次渲染，见下）
  }
  // 首次挂载 open=false 时 prevOpen===open，不会进 closing（closingDone 初始 true）。

  // Escape 关闭抽屉（closing 期间再按不重复触发）
  useEffect(() => {
    if (!open || closing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closing, onOpenChange]);

  // 焦点管理：打开时进入抽屉，关闭时回到触发它的按钮（顶栏汉堡）。
  // 这里恢复 focusRestore 元素而非挂载节点，因此不受延迟卸载影响——
  // open 变 false 时归还焦点，面板要到动画结束才真正移除。
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => previous?.focus?.();
  }, [open]);

  // 收尾记账：closingDone 在退出动画播完时置位（见 onAnimationEnd）。
  // reduced-motion 下没有动画事件，onAnimationEnd 不会触发，关闭时直接同步收尾。
  const endClosing = () => setClosingDone(true);
  const handleClose = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) endClosing();
    onOpenChange(false);
  };

  // 关闭期间（closing）面板上的交互一律走「先收尾再执行」，否则会卡在退出动画状态：
  // 点遮罩/关闭按钮重复调用无害（onOpenChange(false) 幂等）；选中对话/新对话在
  // closing 时本来面板即将卸载，用户看不到中间态，不必特殊处理。

  return (
    <>
      {/*
        常驻左栏。self-start + sticky 让它在长文档滚动时留在视口里。
        这里有两个和左下角浮动按钮（设置/主题，占视口左下 104px 高、x=16..56）相关的数值：
        - max-h 用 calc(100vh-8rem) 而不是更"自然"的 calc(100vh-3rem)：栏在静止时顶部
          并不在视口顶端（顶部还有顶栏，实测 82px），只减 3rem 会让长列表的底边落到
          视口外、最后一条被截掉；
        - pb-28（112px）让列表内容止步于按钮上方：栏的左边缘在窄于约 1328px 时会落到
          x=24，正好压在按钮那条竖带里。
        两者合起来保证「列表滚到底时最后一条仍在按钮上方约 50px」，且与视口高度无关。
        改按钮尺寸/位置或这两个数值时要重新实测。理由同页脚 pl-12，详见 AGENTS.md
        「浮动按钮与页面底部布局」。
      */}
      <aside
        aria-label="历史记录"
        className="sticky top-6 hidden max-h-[calc(100vh-8rem)] w-60 shrink-0 self-start flex-col overflow-y-auto rounded-2xl border border-border bg-surface pb-28 shadow-sm xl:flex"
      >
        <HistoryList
          conversations={conversations}
          activeId={activeId}
          onSelect={onSelect}
          onNew={onNew}
          onDelete={onDelete}
        />
      </aside>

      {/*
        窄屏抽屉。fixed 元素脱离文档流，放在 flex 行里不会影响布局。
        面板上的 w-60 必须给：抽屉是 flex 列容器且内容都可收缩，不给宽度就按内容
        收缩成 ~200px（实测），标题被截得比宽屏左栏还窄；与左栏同宽才一致。
        max-w-[85vw] 兜住极窄屏，避免 240px 在小屏上占满整屏。
      */}
      {(open || closing) && (
        <div
          onClick={(e) => {
            // 只认点遮罩空白处：面板是遮罩子元素，面板内按下拖到遮罩上松手不该关
            //（同 SettingsPanel 的写法，见 AGENTS.md 界面开发约定 7）
            if (e.target === e.currentTarget) handleClose();
          }}
          className={
            "fixed inset-0 z-[90] bg-black/40 backdrop-blur-[2px] xl:hidden " +
            (closing ? "animate-modal-fade-out" : "animate-modal-fade")
          }
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="历史记录"
            onAnimationEnd={(e) => {
              // 退出动画（滑出/淡出）播完才真正卸载；进入动画结束时 closing 还是 false，不受影响
              if (closing && e.target === e.currentTarget) endClosing();
            }}
            className={
              "absolute inset-y-0 left-0 flex w-60 max-w-[85vw] flex-col overflow-y-auto border-r border-border bg-surface pb-28 shadow-2xl " +
              (closing ? "animate-drawer-out" : "animate-drawer-in")
            }
          >
            <HistoryList
              conversations={conversations}
              activeId={activeId}
              onSelect={onSelect}
              onNew={onNew}
              onDelete={onDelete}
            />
            <button
              type="button"
              onClick={handleClose}
              className={buttonClass("secondary", "sm") + " mx-3 mb-3"}
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function HistoryList({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: HistoryListProps) {
  return (
    <>
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2">
        <h2 className="text-xs font-semibold tracking-tight text-text-muted">
          历史记录
        </h2>
        <button
          type="button"
          onClick={onNew}
          className={buttonClass("secondary", "xs")}
        >
          新对话
        </button>
      </div>

      <ul className="space-y-1 p-2">
        {conversations.length === 0 && (
          <li className="px-2 py-3 text-xs leading-relaxed text-text-faint">
            还没有对话记录。发送第一条消息后会自动保存到这里。
          </li>
        )}
        {conversations.map((c) => {
          const active = c.id === activeId;
          return (
            <li key={c.id} className="relative">
              <button
                type="button"
                data-conversation-id={c.id}
                onClick={() => onSelect(c.id)}
                aria-current={active ? "true" : undefined}
                className={
                  "block w-full rounded-xl border px-2.5 py-2 pr-8 text-left transition-colors " +
                  (active
                    ? "border-brand-ring bg-brand-soft"
                    : "border-transparent hover:bg-surface-muted")
                }
              >
                <span
                  className={
                    "block truncate text-sm " +
                    (active ? "font-medium text-brand" : "text-foreground")
                  }
                >
                  {c.title}
                </span>
                <span className="mt-0.5 block text-[11px] text-text-faint">
                  {formatRelativeTime(c.updatedAt)} · {c.turns.length} 条消息
                </span>
              </button>
              <button
                type="button"
                onClick={() => onDelete(c.id)}
                aria-label={`删除对话：${c.title}`}
                title="删除这条对话"
                className="absolute right-1 top-1.5 rounded-md p-1 text-text-faint transition-colors hover:bg-surface hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring dark:hover:text-red-400"
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
    </>
  );
}

/** 顶栏的「三条横线」按钮：窄屏拉出历史抽屉（宽屏由常驻左栏替代，故 xl:hidden） */
export function ChatHistoryToggle({
  open,
  onClick,
}: {
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="历史记录"
      aria-expanded={open}
      title="历史记录"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-text-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring xl:hidden"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden
      >
        <line x1="4" y1="7" x2="20" y2="7" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <line x1="4" y1="17" x2="20" y2="17" />
      </svg>
    </button>
  );
}
