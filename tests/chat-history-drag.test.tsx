import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ChatHistory } from "@/components/chat/ChatHistory";
import type { Project } from "@/lib/review-schema";

/**
 * 历史列表拖动排序的交互接线测试。
 *
 * 为什么需要它：拖拽的「手感」（浮起、滑开的过渡）只能在真实浏览器里看，
 * 但**接线**（把手抓到哪一条、位移写进哪一行的内联样式、松手提交什么顺序）
 * 完全可以在 jsdom 里守住。这里 mock 掉 jsdom 不实现的几何与指针捕获：
 * - `getBoundingClientRect` 按行高 60 + 间距 4 造出可预测的坐标；
 * - `setPointerCapture` / `releasePointerCapture` 补空实现；
 * jsdom 也没有 PointerEvent，用 MouseEvent 带 pointerId 顶替（React 的
 * onPointer* 监听的是 pointerdown/move/up 事件名，字段够用）。
 */

const H = 60;
const GAP = 4;
const STEP = H + GAP;
const TOP = 100;

function proj(id: string, order: number, title: string): Project {
  return {
    id,
    title,
    doc: {
      id: `doc_${id}`,
      title,
      blocks: [{ id: "p_1", type: "paragraph", text: title }],
      revision: 1,
      checksum: "abc",
      updatedAt: "2026-09-16T00:00:00.000Z",
    },
    reviews: [],
    nodes: [],
    lastActivityAt: "2026-09-16T00:00:00.000Z",
    order,
  };
}

const PROJECTS = [proj("a", 0, "甲"), proj("b", 1, "乙"), proj("c", 2, "丙")];

/** 让 li 与 ul 的 getBoundingClientRect 返回可预测的堆叠坐标 */
function mockGeometry(ul: HTMLElement) {
  const rows = Array.from(ul.querySelectorAll<HTMLElement>("li[data-entry-id]"));
  rows.forEach((li, i) => {
    vi.spyOn(li, "getBoundingClientRect").mockReturnValue({
      top: TOP + i * STEP,
      bottom: TOP + i * STEP + H,
      height: H,
      left: 0,
      right: 200,
      width: 200,
      x: 0,
      y: TOP + i * STEP,
      toJSON: () => ({}),
    } as DOMRect);
  });
  vi.spyOn(ul, "getBoundingClientRect").mockReturnValue({
    top: TOP,
    bottom: TOP + rows.length * STEP - GAP,
    height: rows.length * STEP - GAP,
    left: 0,
    right: 200,
    width: 200,
    x: 0,
    y: TOP,
    toJSON: () => ({}),
  } as DOMRect);
}

/** jsdom 无 PointerEvent：用 MouseEvent 补 pointerId */
function pointer(type: string, clientY: number, pointerId = 1) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
  Object.defineProperty(ev, "pointerId", { value: pointerId });
  return ev;
}

function setup(onReorder = vi.fn()) {
  const { container } = render(
    <ChatHistory
      projects={PROJECTS}
      activeId={null}
      onSelect={() => {}}
      onNew={() => {}}
      onDelete={() => {}}
      onReorder={onReorder}
      justCreatedId={null}
      onCreatedShown={() => {}}
      open={false}
      onOpenChange={() => {}}
    />,
  );
  // 宽屏常驻左栏的 aside（第一个渲染分支）
  const ul = container.querySelector("ul")!;
  mockGeometry(ul);
  const rows = () => Array.from(ul.querySelectorAll<HTMLElement>("li[data-entry-id]"));
  return { container, ul, rows, onReorder };
}

function handleOf(ul: HTMLElement, id: string): HTMLElement {
  const li = ul.querySelector<HTMLElement>(`li[data-entry-id="${id}"]`)!;
  return li.querySelector<HTMLElement>('button[aria-label^="调整"]')!;
}

const shiftOf = (ul: HTMLElement, id: string) => {
  const li = ul.querySelector<HTMLElement>(`li[data-entry-id="${id}"]`)!;
  return li.style.transform;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom 不实现指针捕获，补空实现（组件会调用 set/release）
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

describe("历史列表：拖拽接线", () => {
  it("每条可拖条目都有一个拖拽把手（≥2 条时才出现）", () => {
    const { ul } = setup();
    expect(ul.querySelectorAll('button[aria-label^="调整"]')).toHaveLength(3);
  });

  it("只有一条时不显示把手（拖动没有意义）", () => {
    const { container } = render(
      <ChatHistory
        projects={[PROJECTS[0]]}
        activeId={null}
        onSelect={() => {}}
        onNew={() => {}}
        onDelete={() => {}}
        onReorder={vi.fn()}
        justCreatedId={null}
        onCreatedShown={() => {}}
        open={false}
        onOpenChange={() => {}}
      />,
    );
    const ul = container.querySelector("ul")!;
    expect(ul.querySelectorAll('button[aria-label^="调整"]')).toHaveLength(0);
  });

  it("按下把手并向下拖 → 被拖行跟手位移、中间行上移让位", () => {
    const { ul } = setup();
    const handle = handleOf(ul, "a"); // 第 1 行
    act(() => {
      fireEvent(handle, pointer("pointerdown", TOP + 30));
      // 拖到列表最末行之下（越过所有行的中点）→ 落点为「最末」
      fireEvent(handle, pointer("pointermove", TOP + 3 * H));
    });

    // 被拖行跟着指针走（下移约 150）
    expect(shiftOf(ul, "a")).toMatch(/translateY\(1[0-9]{2}/);
    // 中间两行各上移一行，腾出空位
    expect(shiftOf(ul, "b")).toBe(`translateY(${-STEP}px)`);
    expect(shiftOf(ul, "c")).toBe(`translateY(${-STEP}px)`);
  });

  it("边缘一接触就让位（不必等拖到邻居中心，这是用户报过的时机问题）", () => {
    const { ul } = setup();
    const handle = handleOf(ul, "a"); // 第 1 行，占 TOP..TOP+H
    // 行间距 4px，只往下挪 5px：底边刚进入第 2 行的盒子 → 立刻让位
    // （旧实现按「中心过半」判定，要推进到约 +H/2 才动作）
    act(() => {
      fireEvent(handle, pointer("pointerdown", TOP + 30));
      fireEvent(handle, pointer("pointermove", TOP + 35));
    });
    expect(shiftOf(ul, "b")).toBe(`translateY(${-STEP}px)`);
    // 位移为 0（还没接触）时不动作
    cleanup();
    const s2 = setup();
    const h2 = handleOf(s2.ul, "a");
    act(() => {
      fireEvent(h2, pointer("pointerdown", TOP + 30));
      fireEvent(h2, pointer("pointermove", TOP + 30));
    });
    expect(shiftOf(s2.ul, "b")).toBeFalsy();
  });

  it("向上拖 → 中间行下移让位", () => {
    const { ul } = setup();
    const handle = handleOf(ul, "c"); // 第 3 行
    act(() => {
      fireEvent(handle, pointer("pointerdown", TOP + 2 * STEP + 30));
      fireEvent(handle, pointer("pointermove", TOP + 10)); // 拖到最顶
    });

    expect(shiftOf(ul, "c")).toMatch(/translateY\(-/);
    expect(shiftOf(ul, "a")).toBe(`translateY(${STEP}px)`);
    expect(shiftOf(ul, "b")).toBe(`translateY(${STEP}px)`);
  });

  it("松手后按落点提交新顺序（把第 1 行拖到最末）", async () => {
    vi.useFakeTimers();
    const { ul, onReorder } = setup();
    const handle = handleOf(ul, "a");
    act(() => {
      fireEvent(handle, pointer("pointerdown", TOP + 30));
      fireEvent(handle, pointer("pointermove", TOP + 3 * H));
      fireEvent(handle, pointer("pointerup", TOP + 3 * H));
    });
    const landing = ul.querySelector<HTMLElement>('li[data-entry-id="a"]')!;
    expect(landing.className).toContain("t-drag-settle");
    expect(landing.className).not.toContain("t-drag-lift");
    expect(landing.className).not.toContain("t-drag-shift");
    // 短落位动画走完才提交（避免视觉与数据错位）
    act(() => {
      vi.advanceTimersByTime(180);
    });
    expect(onReorder).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(20));
    vi.useRealTimers();
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder.mock.calls[0][0]).toEqual(["b", "c", "a"]);
  });

  it("没移动就松手不提交（没有实际变化）", () => {
    vi.useFakeTimers();
    const { ul, onReorder } = setup();
    const handle = handleOf(ul, "b");
    act(() => {
      fireEvent(handle, pointer("pointerdown", TOP + STEP + 30));
      fireEvent(handle, pointer("pointermove", TOP + STEP + 30)); // 位移 0 = 仍在原位
      fireEvent(handle, pointer("pointerup", TOP + STEP + 30));
    });
    act(() => {
      // 要盖过 SETTLE_MS（回落动画时长 + 余量）
      vi.advanceTimersByTime(500);
    });
    vi.useRealTimers();
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("pointercancel 取消拖动并恢复原位，不提交排序", () => {
    vi.useFakeTimers();
    const { ul, onReorder } = setup();
    const handle = handleOf(ul, "a");
    act(() => {
      fireEvent(handle, pointer("pointerdown", TOP + 30));
      fireEvent(handle, pointer("pointermove", TOP + 3 * H));
      fireEvent(handle, pointer("pointercancel", TOP + 3 * H));
    });
    expect(onReorder).not.toHaveBeenCalled();
    expect(shiftOf(ul, "a")).toBeFalsy();
    expect(ul.className).not.toContain("t-drag-list");
    vi.useRealTimers();
  });

  it("请求处理中锁定新建、删除、切换和排序", () => {
    const onNew = vi.fn();
    const onDelete = vi.fn();
    const onSelect = vi.fn();
    const onReorder = vi.fn();
    const { container } = render(
      <ChatHistory
        projects={PROJECTS}
        activeId={null}
        onSelect={onSelect}
        onNew={onNew}
        onDelete={onDelete}
        onReorder={onReorder}
        justCreatedId={null}
        onCreatedShown={() => {}}
        open={false}
        onOpenChange={() => {}}
        interactionLocked
      />,
    );
    const ul = container.querySelector("ul")!;
    mockGeometry(ul);
    expect(container.querySelector<HTMLButtonElement>('button[aria-label^="调整"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('button[aria-label^="删除文章"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('button[data-project-id="a"]')?.disabled).toBe(true);
    const newButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "新文章",
    )!;
    expect(newButton.disabled).toBe(true);
    fireEvent.click(container.querySelector<HTMLButtonElement>('button[data-project-id="a"]')!);
    fireEvent.click(container.querySelector<HTMLButtonElement>('button[aria-label^="删除文章"]')!);
    fireEvent.click(newButton);
    fireEvent.keyDown(container.querySelector<HTMLButtonElement>('button[aria-label^="调整"]')!, { key: "ArrowDown" });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    expect(onNew).not.toHaveBeenCalled();
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("键盘 ↑/↓ 移动一位并提交（纯拖拽对键盘不可用，这是可访问性兜底）", () => {
    const { ul, onReorder } = setup();
    const handle = handleOf(ul, "b");
    act(() => {
      fireEvent.keyDown(handle, { key: "ArrowUp" });
    });
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder.mock.calls[0][0]).toEqual(["b", "a", "c"]);
    // 播报文案带标题与目标位次
    expect(String(onReorder.mock.calls[0][1])).toContain("乙");
  });

  it("键盘在两端不再越界", () => {
    const { ul, onReorder } = setup();
    act(() => {
      fireEvent.keyDown(handleOf(ul, "a"), { key: "ArrowUp" });
      fireEvent.keyDown(handleOf(ul, "c"), { key: "ArrowDown" });
    });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("点删除按钮不会被当成拖动", () => {
    const onDelete = vi.fn();
    const { container } = render(
      <ChatHistory
        projects={PROJECTS}
        activeId={null}
        onSelect={() => {}}
        onNew={() => {}}
        onDelete={onDelete}
        onReorder={vi.fn()}
        justCreatedId={null}
        onCreatedShown={() => {}}
        open={false}
        onOpenChange={() => {}}
      />,
    );
    const ul = container.querySelector("ul")!;
    mockGeometry(ul);
    const del = ul.querySelector<HTMLElement>('button[aria-label^="删除文章"]')!;
    fireEvent.click(del);
    expect(onDelete).toHaveBeenCalledWith("a");
  });

  it("点条目的主体仍是「打开文章」，不受拖动影响", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <ChatHistory
        projects={PROJECTS}
        activeId={null}
        onSelect={onSelect}
        onNew={() => {}}
        onDelete={() => {}}
        onReorder={vi.fn()}
        justCreatedId={null}
        onCreatedShown={() => {}}
        open={false}
        onOpenChange={() => {}}
      />,
    );
    const card = container.querySelector<HTMLElement>('button[data-project-id="a"]')!;
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith("a");
  });

  it("拖动中给列表加 .t-drag-list（禁选中文字），抬起后移除", () => {
    const { ul } = setup();
    const handle = handleOf(ul, "a");
    act(() => {
      fireEvent(handle, pointer("pointerdown", TOP + 30));
    });
    expect(ul.className).toContain("t-drag-list");
    fireEvent(handle, pointer("pointerup", TOP + 30));
    expect(ul.className).not.toContain("t-drag-list");
  });

  it("被拖条目带浮起类，其余条目带过渡类（滑开才有动画）", () => {
    const { ul } = setup();
    const handle = handleOf(ul, "a");
    act(() => {
      fireEvent(handle, pointer("pointerdown", TOP + 30));
      fireEvent(handle, pointer("pointermove", TOP + 2 * H + 50));
    });
    const liA = ul.querySelector<HTMLElement>('li[data-entry-id="a"]')!;
    const liB = ul.querySelector<HTMLElement>('li[data-entry-id="b"]')!;
    expect(liA.className).toContain("t-drag-lift");
    expect(liB.className).toContain("t-drag-shift");
    // 被拖的那条跟手时不能有过渡，否则会拖泥带水
    expect(liA.className).not.toContain("t-drag-shift");
  });

  it("反复跨过阈值时，让位条目回到原位仍保留同一过渡类", () => {
    const { ul } = setup();
    const handle = handleOf(ul, "a");
    act(() => {
      fireEvent(handle, pointer("pointerdown", TOP + 30));
      fireEvent(handle, pointer("pointermove", TOP + 35));
    });
    const liB = ul.querySelector<HTMLElement>('li[data-entry-id="b"]')!;
    expect(liB.style.transform).toBe(`translateY(${-STEP}px)`);
    expect(liB.className).toContain("t-drag-shift");

    act(() => {
      fireEvent(handle, pointer("pointermove", TOP + 30));
    });
    expect(liB.style.transform).toBe("");
    expect(liB.className).toContain("t-drag-shift");
  });
});

describe("历史抽屉标题按钮", () => {
  it("默认显示历史记录，指针移动后切到新文章并写入倾斜位置", () => {
    const { container } = render(
      <ChatHistory
        projects={[]}
        activeId={null}
        onSelect={() => {}}
        onNew={() => {}}
        onDelete={() => {}}
        onReorder={() => {}}
        justCreatedId={null}
        onCreatedShown={() => {}}
        open
        onOpenChange={() => {}}
      />,
    );
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const control = container.querySelector<HTMLElement>(".t-drawer-title-control")!;
    const history = container.querySelector<HTMLElement>(".t-drawer-title-idle")!;
    const newArticle = container.querySelector<HTMLButtonElement>(".t-drawer-new-button")!;
    vi.spyOn(control, "getBoundingClientRect").mockReturnValue({
      top: 20,
      bottom: 60,
      height: 40,
      left: 100,
      right: 196.2,
      width: 96.2,
      x: 100,
      y: 20,
      toJSON: () => ({}),
    } as DOMRect);

    expect(document.activeElement).toBe(dialog);
    expect(history.style.opacity).toBe("1");
    expect(newArticle.style.opacity).toBe("0");

    act(() => {
      fireEvent.pointerMove(control, { clientX: 180, clientY: 28 });
    });
    expect(history.style.opacity).toBe("0");
    expect(newArticle.style.opacity).toBe("1");
    expect(control.style.getPropertyValue("--tilt-rx")).not.toBe("");
    expect(control.style.getPropertyValue("--tilt-ry")).not.toBe("");

    act(() => {
      fireEvent.pointerLeave(control);
    });
    expect(history.style.opacity).toBe("1");
    expect(newArticle.style.opacity).toBe("0");
  });
});
