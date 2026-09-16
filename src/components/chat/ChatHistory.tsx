"use client";

import { useEffect, useRef, useState } from "react";
import type { Project } from "@/lib/review-schema";
import { deriveProjectTitle, formatRelativeTime } from "@/lib/chat-history";
import { buttonClass } from "@/components/ui/button";

/**
 * 左侧历史记录（项目列表）：一项 = 一篇文章的完整工作现场（正文 + 建议 + 聊天）。
 *
 * 响应式两种形态，同一个列表组件复用：
 * - 宽屏（xl 及以上）：常驻左栏，sticky 跟随滚动；
 * - 窄屏：收起，由顶栏的「三条横线」按钮拉出抽屉（遮罩 + Escape 关闭）。
 *
 * 断点用 xl（1280px）而不是 lg：主内容区在 lg 起就是 [1fr_360px] 两栏，
 * 再挤进 240px 的历史栏，编辑器会窄到不像阅读界面。xl 是能同时放下三栏的下限。
 */

export type ChatHistoryProps = {
  projects: Project[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: (opts?: { keepHistoryOpen?: boolean }) => void;
  onDelete: (id: string) => void;
  /** 刚由「新文章」创建、尚未播过出现动画的项目 id；播完由 onCreatedShown 清掉。
   *  按事件钉 id 而不是按时间取最新：列表里永远有一条最新，初次加载/切回旧项目/
   *  筛选变化都会误触发「蹦」动画。 */
  justCreatedId: string | null;
  onCreatedShown: () => void;
  /** 窄屏抽屉是否展开（xl 及以上忽略） */
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type HistoryListProps = Omit<ChatHistoryProps, "open" | "onOpenChange">;

export function ChatHistory({
  projects,
  activeId,
  onSelect,
  onNew,
  onDelete,
  justCreatedId,
  onCreatedShown,
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
        高度取「内容自适应，但至少六成视口高、至多贴顶且避让左下按钮」：
        - min-h-[60vh]：内容少（一两条）时也撑到约六成高，不再是孤零零一小条；
        - max-h 用 calc(100vh-8rem) 而不是更"自然"的 calc(100vh-3rem)：栏在静止时顶部
          并不在视口顶端（顶部还有顶栏，实测 82px），只减 3rem 会让长列表的底边落到
          视口外、最后一条被截掉；
        - pb-28（112px）让列表内容止步于左下角两个浮动按钮（设置/主题，x=16..56）上方：
          栏的左边缘在窄于约 1328px 时会落到 x=24，正好压在按钮那条竖带里。
        两者合起来保证「列表滚到底时最后一条仍在按钮上方约 50px」，且与视口高度无关。
        改按钮尺寸/位置或这些数值时要重新实测。理由同页脚 pl-12，详见 AGENTS.md
        「浮动按钮与页面底部布局」。
      */}
      <aside
        aria-label="历史记录"
        className="sticky top-6 hidden max-h-[calc(100vh-8rem)] min-h-[60vh] w-60 shrink-0 self-start flex-col overflow-y-auto rounded-2xl border border-border bg-surface pb-28 shadow-sm xl:flex"
      >
        <HistoryList
          projects={projects}
          activeId={activeId}
          onSelect={onSelect}
          onNew={onNew}
          onDelete={onDelete}
          justCreatedId={justCreatedId}
          onCreatedShown={onCreatedShown}
        />
      </aside>

      {/*
        窄屏抽屉。fixed 元素脱离文档流，放在 flex 行里不会影响布局。
        面板必须显式给宽度：抽屉是 flex 列容器且内容都可收缩，不给宽度就按内容收缩。
        w-90（360px）比宽屏左栏 w-60 宽 50%：窄屏一屏只能干一件事，抽屉是主要工作区，宽一点
        标题/最近活动都不容易被截断；max-w-[85vw] 兜住极窄屏。
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
            id="history-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="历史记录"
            // pl-4 与 HistoryList 的 pl-14 配套：标题行让位顶栏汉堡（叉叉），列表行正常缩进
            onAnimationEnd={(e) => {
              // 退出动画（滑出/淡出）播完才真正卸载；进入动画结束时 closing 还是 false，不受影响
              if (closing && e.target === e.currentTarget) endClosing();
            }}
            className={
              "absolute inset-y-0 left-0 flex w-90 max-w-[85vw] flex-col overflow-y-auto border-r border-border bg-surface pb-28 pl-4 shadow-2xl " +
              (closing ? "animate-drawer-out" : "animate-drawer-in")
            }
          >
            <HistoryList
              projects={projects}
              activeId={activeId}
              onSelect={onSelect}
              onNew={onNew}
              onDelete={onDelete}
              justCreatedId={justCreatedId}
              onCreatedShown={onCreatedShown}
              variant="drawer"
            />
          </div>
        </div>
      )}
    </>
  );
}

function HistoryList({
  projects,
  activeId,
  onSelect,
  onNew,
  onDelete,
  justCreatedId,
  onCreatedShown,
  variant = "sidebar",
}: HistoryListProps & { variant?: "sidebar" | "drawer" }) {
  const drawer = variant === "drawer";
  const [titleHover, setTitleHover] = useState(false);
  return (
    <>
      {drawer ? (
        // 抽屉形态：升级成真正的面板标题。左侧 pl-14 让出顶栏汉堡按钮（40px + 左缘 16px），
        // 打开时按钮原地换成叉叉。pt-[24px] + h-10 让叠放层与顶栏内垂直居中的按钮中线对齐
        // （实测按钮 top=24/中线 44，叠放层 top=24/h-10 中线 44，逐像素对齐）。
        // 数值与顶栏布局绑定，改顶栏要重测（同 AGENTS.md 左栏 100vh-8rem 的约定级别）。
        <div className="t-skel-wrap flex flex-col gap-3 px-4 pb-3 pl-14 pt-[24px]">
          {/*
            hover 交叉淡入：「历史记录」做成按钮样式与「新文章」等宽，叠在同一位置（group/hover 触发）。
            历史记录靠右侧（ml-auto），hover 时淡出+模糊，新文章从右侧淡入（同宽，不撑开布局）。
            动画 250ms（transitions.dev skeleton-reveal 思路，见 globals.css .t-skel-*）。
          */}
          <div
            className="group relative ml-auto inline-flex h-10 items-center"
            onMouseEnter={() => setTitleHover(true)}
            onMouseLeave={() => setTitleHover(false)}
          >
            {/* 层 1：历史记录（hover 时淡出） */}
            <div
              role="presentation"
              className="t-skel-skeleton flex h-10 items-center rounded-lg bg-surface-muted px-3"
              style={{
                opacity: titleHover ? 0 : 1,
                filter: titleHover ? "blur(2px)" : "blur(0px)",
                transition: "opacity 250ms ease-in-out, filter 250ms ease-in-out",
              }}
            >
              <span className="text-lg font-medium tracking-tight text-foreground">
                历史记录
              </span>
            </div>
            {/* 层 2：新文章（hover 时淡入，字间距调宽与历史记录同宽）。
                「可按下」用扁平凸起三件套表达：背景抬亮到纸面 + 上抬 1px + 软投影；
                active 把位移/投影收回 + scale 0.98，因果关系完整。投影变量见 globals.css
                （深色下黑投影弱，位移+抬亮兜底，方案 a）。淡入淡出仍走内联 style。 */}
            <button
              type="button"
              onClick={() => onNew({ keepHistoryOpen: true })}
              className={
                "t-skel-content absolute inset-y-0 right-0 my-auto flex h-10 w-[96.2px] items-center justify-center rounded-lg bg-surface-muted !text-lg font-medium !tracking-[0.3em] text-foreground transition-[transform,box-shadow,background-color] duration-150 hover:-translate-y-px hover:bg-surface hover:shadow-[var(--new-btn-shadow)] active:translate-y-0 active:bg-border/50 active:shadow-[var(--new-btn-shadow-active)] active:scale-[0.98]"
              }
              style={{
                opacity: titleHover ? 1 : 0,
                filter: titleHover ? "blur(0px)" : "blur(2px)",
                transition: "opacity 250ms ease-in-out, filter 250ms ease-in-out",
              }}
            >
              新文章
            </button>
          </div>
        </div>
      ) : (
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2">
          <h2 className="text-xs font-semibold tracking-tight text-text-muted">
            历史记录
          </h2>
          <button
            type="button"
            onClick={() => onNew()}
            className={buttonClass("secondary", "xs")}
          >
            新文章
          </button>
        </div>
      )}

      <ul className="space-y-1 p-2">
        {projects.length === 0 && (
          <li className="px-2 py-3 text-xs leading-relaxed text-text-faint">
            还没有文章。开始审阅或发送第一条消息后会自动保存到这里。
          </li>
        )}
        {projects.map((p) => (
          <HistoryEntry
            key={p.id}
            project={p}
            active={p.id === activeId}
            justCreated={p.id === justCreatedId}
            onSelect={onSelect}
            onDelete={onDelete}
            onCreatedShown={onCreatedShown}
          />
        ))}
      </ul>
    </>
  );
}

/** 单条历史项目。刚创建（点「新文章」）的那一条播 toast-rise 出现动画：
 *  外层 li 占位从 0fr 长到 1fr（兄弟项被连续顶下去），内层内容从格底 rise+fade。
 *  播完回调清掉全局 justCreatedId，之后该条目与其他条目无异（筛选/重排不重演）。 */
function HistoryEntry({
  project: p,
  active,
  justCreated,
  onSelect,
  onDelete,
  onCreatedShown,
}: {
  project: Project;
  active: boolean;
  justCreated: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onCreatedShown: () => void;
}) {
  // 渲染期 derived state（React 官方模式，同外层 closing 的写法）：justCreated 在防抖建档
  // （~500ms 后）才变 true，命中时本条目已挂载，在渲染体内 setState、同渲染内立即重跑，
  // 下一帧带 is-open 提交——动画从挂载首帧起步，与交叉淡入的初始态同理。
  // 同批内不清 justCreated（要等动画播完由 onTransitionEnd 回调），否则这 500ms 窗口里
  // 其他条目进列表会短暂误命中。
  const [roseFor, setRoseFor] = useState<string | null>(null);
  if (justCreated && roseFor !== p.id) setRoseFor(p.id);
  const riseOpen = roseFor === p.id;
  // 标题实时从 doc 派生（doc.title 优先，空则首段截断），不用落库时的快照 p.title——
  // 这样左上角标题框改一个字，这里立刻跟着变，两处始终是同一个标题（单一事实源）。
  const title = deriveProjectTitle(p.doc);
  return (
    <li
      className={"t-toast-rise relative" + (riseOpen ? " is-open" : "")}
      onTransitionEnd={(e) => {
        // 占位生长播完（grid-template-rows 过渡结束）即视为出现动画完成
        if (justCreated && e.target === e.currentTarget && e.propertyName === "grid-template-rows")
          onCreatedShown();
      }}
    >
      <div className="t-toast-content">
        <button
          type="button"
          data-project-id={p.id}
          onClick={() => onSelect(p.id)}
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
            {title}
          </span>
          <span className="mt-0.5 block text-[11px] text-text-faint">
            最近活动：{formatRelativeTime(p.lastActivityAt)}
          </span>
        </button>
        <button
          type="button"
          onClick={() => onDelete(p.id)}
          aria-label={`删除文章：${title}`}
          title="删除这篇文章"
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
      </div>
    </li>
  );
}

/** 顶栏的历史抽屉开关：窄屏拉出/收起抽屉（宽屏由常驻左栏替代，故 xl:hidden）。
 *  打开时同一位置原地换成叉叉（内部双 SVG 叠格切换），配冷却期防抖双击。 */
export function ChatHistoryToggle({
  open,
  onClick,
}: {
  open: boolean;
  onClick: () => void;
}) {
  // 冷却：点击后 500ms 内（抽屉动画 250ms + 250ms）忽略同位置再次点击。
  // 既防抖双击，也顺带挡住「关闭动画中途又点开」的边界；reduced-motion 下没有动画，
  // 只剩 250ms。CSS 只禁用 transition，冷却要在 JS 层做。
  const cooldownRef = useRef(0);
  const handleClick = () => {
    const now = Date.now();
    if (now - cooldownRef.current < 500) return;
    cooldownRef.current = now;
    onClick();
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="历史记录"
      aria-expanded={open}
      title="历史记录"
      // z-100：抽屉遮罩 z-90 会盖住顶栏，不提升的话打开后叉叉被压在遮罩下点不到
      className="relative z-[100] flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-text-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring xl:hidden"
    >
      {/* 双图标同位叠格：data-state 切换（transitions.dev Icon swap 思路，见 globals.css） */}
      <span className="t-icon-swap" data-state={open ? "b" : "a"}>
        <svg
          className="t-icon"
          data-icon="a"
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
        <svg
          className="t-icon"
          data-icon="b"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
        >
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="6" y1="18" x2="18" y2="6" />
        </svg>
      </span>
    </button>
  );
}
