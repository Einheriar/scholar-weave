"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Project } from "@/lib/review-schema";
import {
  deriveProjectTitle,
  dragShifts,
  dragTargetIndex,
  formatRelativeTime,
  moveId,
} from "@/lib/chat-history";
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
  /** 手动拖动 / 键盘移动后提交新的顺序（完整 id 列表，从前往后）。
   *  message 供无障碍播报（走 page 的 aria-live），省略时用默认文案。 */
  onReorder: (orderedIds: string[], message?: string) => void;
  /** 刚由「新文章」创建、尚未播过出现动画的项目 id；播完由 onCreatedShown 清掉。
   *  按事件钉 id 而不是按时间取最新：列表里永远有一条最新，初次加载/切回旧项目/
   *  筛选变化都会误触发「蹦」动画。 */
  justCreatedId: string | null;
  onCreatedShown: () => void;
  /** 窄屏抽屉是否展开（xl 及以上忽略） */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 付费请求进行中时锁定文章现场，禁止切换/新建/删除/排序。 */
  interactionLocked?: boolean;
};

type HistoryListProps = Omit<ChatHistoryProps, "open" | "onOpenChange">;

export function ChatHistory({
  projects,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onReorder,
  justCreatedId,
  onCreatedShown,
  open,
  onOpenChange,
  interactionLocked = false,
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
    panelRef.current?.focus();
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
          onReorder={onReorder}
          justCreatedId={justCreatedId}
          onCreatedShown={onCreatedShown}
          interactionLocked={interactionLocked}
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
            tabIndex={-1}
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
              onReorder={onReorder}
              justCreatedId={justCreatedId}
              onCreatedShown={onCreatedShown}
              interactionLocked={interactionLocked}
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
  onReorder,
  justCreatedId,
  onCreatedShown,
  interactionLocked = false,
  variant = "sidebar",
}: HistoryListProps & { variant?: "sidebar" | "drawer" }) {
  const drawer = variant === "drawer";
  const [titleHover, setTitleHover] = useState(false);
  const handleTitlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    setTitleHover(true);
    event.currentTarget.classList.add("is-hover");
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    const rx = (0.5 - y) * 16;
    const ry = (x - 0.5) * 24;

    event.currentTarget.style.setProperty("--tilt-rx", `${rx.toFixed(2)}deg`);
    event.currentTarget.style.setProperty("--tilt-ry", `${ry.toFixed(2)}deg`);
    event.currentTarget.style.setProperty("--tilt-gx", `${(x * 100).toFixed(1)}%`);
    event.currentTarget.style.setProperty("--tilt-gy", `${(y * 100).toFixed(1)}%`);
    event.currentTarget.classList.add("is-tilting");
  };
  const handleTitlePointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.classList.remove("is-hover", "is-tilting");
    event.currentTarget.style.removeProperty("--tilt-rx");
    event.currentTarget.style.removeProperty("--tilt-ry");
    event.currentTarget.style.removeProperty("--tilt-gx");
    event.currentTarget.style.removeProperty("--tilt-gy");
    if (!event.currentTarget.matches(":focus-within")) setTitleHover(false);
  };
  const {
    listRef,
    dragId,
    dragging,
    settling,
    beginDrag,
    moveDrag,
    endDrag,
    cancelDrag,
    moveByKey,
    shiftOf,
  } = useHistoryDrag(projects, onReorder, interactionLocked);
  const lockTitle = "请求处理中，请等待完成后再切换文章";
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
            className="t-drawer-title-control relative ml-auto inline-flex h-10 w-[96.2px] items-center"
            onPointerMove={handleTitlePointerMove}
            onPointerLeave={handleTitlePointerLeave}
          >
            {/* 层 1：历史记录（hover 时淡出） */}
            <div
              role="presentation"
              className="t-skel-skeleton t-drawer-title-idle flex h-10 w-[96.2px] items-center justify-center rounded-lg"
              style={{
                opacity: titleHover ? 0 : 1,
                filter: titleHover ? "blur(2px)" : "blur(0px)",
                transition:
                  "opacity var(--drawer-skel-dur) var(--drawer-skel-ease), filter var(--drawer-skel-dur) var(--drawer-skel-ease)",
              }}
            >
              <span className="text-lg font-medium tracking-tight text-foreground">
                历史记录
              </span>
            </div>
            {/* 层 2：新文章（hover 时淡入，字间距调宽与历史记录同宽）。
                外层保留平面命中区，按钮本体根据指针位置做低幅度 3D 倾斜；高光单独覆盖，
                不再用向下投影制造悬浮感。淡入淡出仍与「历史记录」同步。 */}
            <button
              type="button"
              disabled={interactionLocked}
              aria-disabled={interactionLocked}
              title={interactionLocked ? lockTitle : "新建文章"}
              onClick={() => onNew({ keepHistoryOpen: true })}
              onFocus={(event) => {
                setTitleHover(true);
                event.currentTarget.parentElement?.classList.add("is-hover");
              }}
              onBlur={(event) => {
                setTitleHover(false);
                event.currentTarget.parentElement?.classList.remove("is-hover", "is-tilting");
              }}
              className="t-skel-content t-drawer-new-button absolute inset-0 flex h-10 w-[96.2px] items-center justify-center rounded-lg !text-lg font-medium !tracking-[0.3em] text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring disabled:cursor-not-allowed"
              style={{
                opacity: titleHover ? 1 : 0,
                filter: titleHover ? "blur(0px)" : "blur(2px)",
                transition:
                  "opacity var(--drawer-skel-dur) var(--drawer-skel-ease), filter var(--drawer-skel-dur) var(--drawer-skel-ease), transform var(--tilt-return) var(--tilt-return-ease), scale 140ms ease, background-color 180ms ease, box-shadow 180ms ease",
              }}
            >
              {/*
                tracking-[0.3em] 会在最后一个字后面也追加一个 5.4px 字距，且布局把它算进
                文字宽度——justify-center 居中的是「三字 + 末尾空白」，墨迹因此左偏半个字距
                （实测左偏 2.708px，右空隙比左大一个完整字距）。负右边距把这截尾随留白拉回，
                墨迹才真正居中（CSS 通用手法：负边距抵消字距尾随留白）。
              */}
              <span className="relative z-10 -mr-[0.3em]">新文章</span>
              <span className="t-tilt-spectrum" aria-hidden />
              <span className="t-tilt-glare" aria-hidden />
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
            disabled={interactionLocked}
            aria-disabled={interactionLocked}
            title={interactionLocked ? lockTitle : "新建文章"}
            onClick={() => onNew()}
            className={buttonClass("secondary", "xs")}
          >
            新文章
          </button>
        </div>
      )}

      <ul
        ref={listRef}
        className={"space-y-1 p-2" + (dragging ? " t-drag-list" : "")}
      >
        {projects.length === 0 && (
          <li className="px-2 py-3 text-xs leading-relaxed text-text-faint">
            还没有文章。开始审阅或发送第一条消息后会自动保存到这里。
          </li>
        )}
        {projects.map((p, i) => (
          <HistoryEntry
            key={p.id}
            project={p}
            draggable={projects.length > 1}
            dragging={dragId === p.id}
            settling={settling && dragId === p.id}
            shift={shiftOf(i)}
            animated={dragId !== null && dragId !== p.id}
            active={p.id === activeId}
            justCreated={p.id === justCreatedId}
            onSelect={onSelect}
            onDelete={onDelete}
            onCreatedShown={onCreatedShown}
            onHandlePointerDown={beginDrag}
            onHandlePointerMove={moveDrag}
            onHandlePointerUp={endDrag}
            onHandlePointerCancel={cancelDrag}
            onHandleKeyDown={moveByKey}
            interactionLocked={interactionLocked}
            lockTitle={lockTitle}
          />
        ))}
      </ul>
    </>
  );
}

/** 松手落位等待时间（ms）。比 `.t-drag-settle` 的 180ms 多留 10ms，
 *  动画结束后再无过渡地提交 DOM 顺序，避免交接帧产生第二次位移。 */
const LANDING_MS = 190;

/**
 * 列表拖动排序（Pointer Events，不引第三方库）。
 *
 * 为什么用 Pointer 而不是 HTML5 DnD：这个列表有窄屏抽屉形态，触屏场景真实存在，
 * 而 HTML5 拖放在触屏上基本不可用；Pointer Events 一套同时覆盖鼠标/触屏/触控笔。
 *
 * 交互挂在**独立的拖拽把手**上（不是整行按钮）：行本身是「点开文章」的 button，
 * 在里面还嵌了删除 button，把拖动挂在整行会让点击语义打架。把手带 `touch-action:none`
 * 防止触屏滚动抢走手势——**列表其他地方仍可正常滚动**（这正是保留把手而非整行拖的收益）。
 *
 * 拖动期间的视觉（「浮起 + 其余项滑开」）：
 * - **不改 DOM 顺序**，只改 transform。被拖条目的 translateY 由 JS 直写内联样式跟手走，
 *   并挂 `.t-drag-lift` 浮起（放大 + 阴影 + z-index）；
 * - 其余条目按各自「让位距离」做 translateY，靠 `.t-drag-shift` 的 CSS transition 平滑滑开。
 *   让位距离 = 相邻槽位顶部之差（含行间距），而且拖动全程保留 transition，滑开与回原位同速同曲线。
 * 边拖边真重排数组会让行在指针下跳位、且每帧触发 React 重渲染，所以不做。
 *
 * 松手：被拖条目改走更短的 `.t-drag-settle`，位置、缩放和阴影同步落稳；
 * 动画结束才无过渡地提交顺序，视觉与数据不会错位。
 */
function useHistoryDrag(
  projects: Project[],
  onReorder: ChatHistoryProps["onReorder"],
  interactionLocked: boolean,
) {
  const listRef = useRef<HTMLUListElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  /** 被拖条目的实时跟手位移（px，相对它本来的位置） */
  const [dragDy, setDragDy] = useState(0);
  /** 松手后的回落中：条目从当前位置过渡到目标槽位，过渡完才 onReorder */
  const [settling, setSettling] = useState(false);
  /** 被拖条目在列表中的原始下标（state 以便渲染期算位移；ref 供事件回调实时读） */
  const [fromIndex, setFromIndex] = useState(-1);

  const fromRef = useRef<number>(-1);
  // 几何快照：拖动开始那一刻每个条目相对列表顶部的偏移与行高。
  // 拖动期间**保持用这份快照**算落点，不受自身 transform 影响（否则会自我循环）。
  //
  // 同时存 ref 与 state 两份，各有用途、不能省：
  // - `geoRef`：事件回调（pointerup 算落点）里要读到**刚刚写入**的值。state 更新要等重渲染，
  //   在同一个事件处理链里读 state 会拿到旧值（踩过：转成纯 state 后松手时落点算错、不提交）；
  // - `geoState`：渲染期算每行位移要用，而 ref 不允许在渲染期读（react-hooks/refs 规则）。
  const geoRef = useRef<{ tops: number[]; h: number }>({ tops: [], h: 0 });
  const [geoState, setGeoState] = useState<{ tops: number[]; h: number }>({ tops: [], h: 0 });
  const pointerStartY = useRef(0);
  const dyRef = useRef(0);
  /** 拖动期间累计的自动滚动量（px），累加进跟手位移 */
  const scrolledRef = useRef(0);
  /** 松手回落的目标位移，交给内联样式用 transition 过渡 */
  const settleDyRef = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const items = () => Array.from(
    listRef.current?.querySelectorAll<HTMLElement>("li[data-entry-id]") ?? [],
  );

  /** 靠近上下边缘时自动滚动列表的可滚祖先（抽屉/左栏都是 overflow-y-auto） */
  const autoScroll = (clientY: number) => {
    let el: HTMLElement | null = listRef.current?.parentElement ?? null;
    while (el && el.scrollHeight <= el.clientHeight) el = el.parentElement;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const EDGE = 36;
    let delta = 0;
    if (clientY < r.top + EDGE) delta = -10;
    else if (clientY > r.bottom - EDGE) delta = 10;
    if (delta) el.scrollTop += delta;
    return delta;
  };

  const beginDrag = (e: React.PointerEvent<HTMLElement>, id: string) => {
    if (interactionLocked || projects.length < 2 || settling) return;
    const lis = items();
    const from = projects.findIndex((p) => p.id === id);
    if (from < 0 || lis.length === 0) return;
    // 捕获指针：指针移出把手（甚至移出窗口）仍能收到 move/up
    e.currentTarget.setPointerCapture(e.pointerId);
    const listTop = listRef.current!.getBoundingClientRect().top;
    const snapshot = {
      tops: lis.map((li) => li.getBoundingClientRect().top - listTop),
      h: lis[0].getBoundingClientRect().height,
    };
    geoRef.current = snapshot;
    setGeoState(snapshot);
    fromRef.current = from;
    setFromIndex(from);
    pointerStartY.current = e.clientY;
    dyRef.current = 0;
    scrolledRef.current = 0;
    setDragDy(0);
    setDragId(id);
  };

  const moveDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (interactionLocked || fromRef.current < 0 || settling) return;
    // 自动滚动会让条目的「基准位置」随内容上移；把滚动量累加进位移，
    // 浮起的条目才会一直待在指针下面，而不是被滚走。
    const scrolled = autoScroll(e.clientY);
    if (scrolled) scrolledRef.current += scrolled;
    dyRef.current = e.clientY - pointerStartY.current + scrolledRef.current;
    setDragDy(dyRef.current);
    // 落点（哪一行该让位）不再单独记 state：它完全由 dy 决定，
    // 在渲染期用 dragTargetIndex 从几何快照 + dy 推出来即可（少一份会不同步的状态）。
  };

  const endDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (fromRef.current < 0) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* 指针已释放 */
    }
    if (interactionLocked) return finish(null);
    const from = fromRef.current;
    const { tops, h } = geoRef.current;
    // 用松手时的最终位移重算落点（与渲染期同一条纯函数，保证「看到的落点 = 提交的落点」）
    const to = dragTargetIndex(tops, h, from, dyRef.current);
    if (to === from) return finish(null);
    // 松手先播回落：条目过渡到目标槽位（tops[to] 就是它换位后的视觉位置），
    // 过渡结束才真正提交顺序；这样动画与数据不会错位。
    const target = tops[to] ?? tops[from];
    settleDyRef.current = target - tops[from];
    setDragDy(settleDyRef.current);
    setSettling(true);
    clearSettleTimer();
    settleTimer.current = setTimeout(
      () => finish(moveId(projects.map((p) => p.id), from, to)),
      // 略大于 .t-drag-settle 的 180ms，等落位过渡真的走完。
      LANDING_MS,
    );
    return;
  };

  const cancelDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (fromRef.current < 0) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* 指针已释放 */
    }
    finish(null);
  };

  /** 收尾：清空拖动视觉并（可选）提交新顺序 */
  function finish(orderedIds: string[] | null) {
    clearSettleTimer();
    setDragId(null);
    setSettling(false);
    setDragDy(0);
    fromRef.current = -1;
    setFromIndex(-1);
    dyRef.current = 0;
    if (orderedIds) onReorder(orderedIds);
  }

  function clearSettleTimer() {
    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
  }
  useEffect(() => clearSettleTimer, []);

  /**
   * 每个条目要做的让位位移（px）：被拖的跟手，其余按插入位让开一行。
   * 几何计算抽到 chat-history 的 `dragShifts` 纯函数，那边有单测守着。
   */
  const toIndex =
    fromIndex < 0
      ? fromIndex
      : dragTargetIndex(geoState.tops, geoState.h, fromIndex, dragDy);
  const shifts = dragShifts(projects.length, fromIndex, toIndex, geoState.tops, dragDy);
  const shiftOf = (index: number): number => shifts[index] ?? 0;

  /** 键盘排序：把手聚焦后 ↑/↓ 上下移动一位（纯拖拽对键盘/读屏不可用） */
  const moveByKey = (e: React.KeyboardEvent<HTMLElement>, id: string) => {
    if (interactionLocked) return;
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const ids = projects.map((p) => p.id);
    const from = ids.indexOf(id);
    if (from < 0) return;
    const to = e.key === "ArrowUp" ? from - 1 : from + 1;
    if (to < 0 || to >= ids.length) return;
    e.preventDefault();
    const title = deriveProjectTitle(projects[from].doc);
    onReorder(moveId(ids, from, to), `「${title}」已移到第 ${to + 1} 位。`);
  };

  // 拖动中禁止选中文字（触屏长按会弹选择菜单）
  const dragging = dragId !== null;
  useEffect(() => {
    if (!dragging) return;
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.userSelect = "";
    };
  }, [dragging]);

  return {
    listRef,
    dragId,
    dragging,
    settling,
    beginDrag,
    moveDrag,
    endDrag,
    cancelDrag,
    moveByKey,
    shiftOf,
  };
}

/** 单条历史项目。刚创建（点「新文章」）的那一条播 toast-rise 出现动画：
 *  外层 li 播 grid 行高 0fr→1fr（兄弟项被容器高度连续顶下去），内层内容从格底 rise+fade。
 *  播完回调清掉全局 justCreatedId。**普通条目走普通 li**——rise 的 grid 结构只挂在
 *  会动的这一条上（曾经无条件挂给所有 li，结果没动画类的条目行高塌成 0、整列看不见）。 */
function HistoryEntry({
  project: p,
  draggable,
  dragging,
  settling,
  shift,
  animated,
  active,
  justCreated,
  onSelect,
  onDelete,
  onCreatedShown,
  onHandlePointerDown,
  onHandlePointerMove,
  onHandlePointerUp,
  onHandlePointerCancel,
  onHandleKeyDown,
  interactionLocked,
  lockTitle,
}: {
  project: Project;
  draggable: boolean;
  dragging: boolean;
  /** 仅被拖条目在松手落位阶段为 true */
  settling: boolean;
  /** 本条目的纵向位移（px）：被拖的跟手、其余按需让位滑开 */
  shift: number;
  /** 其余条目的果冻让位是否走过渡；被拖条目的落位使用独立 class */
  animated: boolean;
  active: boolean;
  justCreated: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onCreatedShown: () => void;
  onHandlePointerDown: (e: React.PointerEvent<HTMLElement>, id: string) => void;
  onHandlePointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onHandlePointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  onHandlePointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
  onHandleKeyDown: (e: React.KeyboardEvent<HTMLElement>, id: string) => void;
  interactionLocked: boolean;
  lockTitle: string;
}) {
  // 渲染期 derived state（React 官方模式，同外层 closing 的写法）：justCreated 在防抖建档
  // （~500ms 后）才变 true，在渲染体内 setState、同渲染内立即重跑，使条目「首次挂载」时就
  // 已带 rise 类——关键帧动画只在挂载时播放，晚一帧再挂就只剩跳变了。
  // 命中后长期保持（roseFor 不再变），该条目之后就是稳定的 grid 1fr，重渲染/筛选不重演。
  const [roseFor, setRoseFor] = useState<string | null>(null);
  if (justCreated && roseFor !== p.id) setRoseFor(p.id);
  const rising = roseFor === p.id;
  // 标题实时从 doc 派生（doc.title 优先，空则首段截断），不用落库时的快照 p.title——
  // 这样左上角标题框改一个字，这里立刻跟着变，两处始终是同一个标题（单一事实源）。
  const title = deriveProjectTitle(p.doc);
  const body = (
    <>
      {/* 拖拽把手：独立的小把手而不是整行——行本身是「点开」按钮、内嵌删除按钮，
          拖动挂在整行会和点击语义打架。touch-action-none 防止触屏滚动抢走手势
          （列表其余位置的滚动因此不受影响，这是保留把手换来的）。
          键盘排序也在这里（纯拖拽对键盘/读屏不可用）。 */}
      {draggable && (
        <button
          type="button"
          disabled={interactionLocked}
          aria-disabled={interactionLocked}
          aria-label={`调整「${title}」顺序`}
          title={interactionLocked ? lockTitle : "拖动排序（也可用 ↑/↓ 键）"}
          onPointerDown={(e) => onHandlePointerDown(e, p.id)}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerCancel}
          onKeyDown={(e) => onHandleKeyDown(e, p.id)}
          // 把手在行按钮之外（兄弟节点），点它不会触发行的 onClick；
          // 但仍要吞掉 click，免得将来把手挪进按钮内部时误开文章。
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-1/2 z-10 -translate-y-1/2 cursor-grab touch-none rounded-md p-1 text-text-faint opacity-0 transition-opacity hover:text-foreground active:cursor-grabbing focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring group-hover/entry:opacity-100"
        >
          <svg
            width="12"
            height="14"
            viewBox="0 0 12 14"
            fill="currentColor"
            aria-hidden
          >
            <circle cx="3" cy="3" r="1.3" />
            <circle cx="9" cy="3" r="1.3" />
            <circle cx="3" cy="7" r="1.3" />
            <circle cx="9" cy="7" r="1.3" />
            <circle cx="3" cy="11" r="1.3" />
            <circle cx="9" cy="11" r="1.3" />
          </svg>
        </button>
      )}
      <button
        type="button"
        disabled={interactionLocked}
        aria-disabled={interactionLocked}
        data-project-id={p.id}
        onClick={() => onSelect(p.id)}
        aria-current={active ? "true" : undefined}
        title={interactionLocked ? lockTitle : `打开文章：${title}`}
        className={
          "block w-full rounded-xl border px-2.5 py-2 pr-8 text-left transition-colors " +
          (draggable ? "pl-6 " : "") +
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
        disabled={interactionLocked}
        aria-disabled={interactionLocked}
        onClick={() => onDelete(p.id)}
        aria-label={`删除文章：${title}`}
        title={interactionLocked ? lockTitle : "删除这篇文章"}
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
    </>
  );
  return (
    <li
      data-entry-id={p.id}
      // 位移走 transform（合成层，不触发布局）：被拖的跟手时不要过渡，否则会拖泥带水；
      // 其余条目用果冻让位，松手后的被拖条目则用更短的落位动画。
      style={shift !== 0 || dragging ? { transform: `translateY(${shift}px)` } : undefined}
      className={
        "group/entry relative" +
        (rising ? " t-toast-rise" : "") +
        (dragging && !settling ? " t-drag-lift" : "") +
        (settling ? " t-drag-settle" : "") +
        (animated ? " t-drag-shift" : "")
      }
      onAnimationEnd={(e) => {
        // 行高关键帧播完即视为出现动画完成（只认外层那条动画，内容层的不算）
        if (e.target === e.currentTarget && e.animationName === "toast-rise-rows")
          onCreatedShown();
      }}
    >
      {rising ? <div className="t-toast-content">{body}</div> : body}
    </li>
  );
}

/** 顶栏的历史抽屉开关：窄屏拉出/收起抽屉（宽屏由常驻左栏替代，故 xl:hidden）。
 *  打开时同一位置原地换成叉叉（内部双 SVG 叠格切换），配冷却期防抖双击。 */
export function ChatHistoryToggle({
  open,
  onClick,
  disabled = false,
}: {
  open: boolean;
  onClick: () => void;
  disabled?: boolean;
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
      disabled={disabled}
      aria-disabled={disabled}
      onClick={handleClick}
      aria-label="历史记录"
      aria-expanded={open}
      title={disabled ? "请求处理中，请等待完成后再操作" : "历史记录"}
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
