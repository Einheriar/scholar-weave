import { describe, expect, it } from "vitest";
import {
  deriveProjectTitle,
  dragShifts,
  formatRelativeTime,
  moveId,
  moveProjectToTop,
  reorderProjects,
  sortProjects,
  upsertProject,
} from "@/lib/chat-history";
import type { DocumentState, Project } from "@/lib/review-schema";

const NOW = new Date("2026-09-15T12:00:00");

function doc(id: string, title: string, firstParagraph: string): DocumentState {
  return {
    id,
    title,
    blocks: [{ id: "p_1", type: "paragraph", text: firstParagraph }],
    revision: 1,
    checksum: "abc12345",
    updatedAt: "2026-09-15T10:00:00.000Z",
  };
}

function proj(id: string, lastActivityAt: string, order?: number): Project {
  return {
    id,
    title: `文章 ${id}`,
    doc: doc(`doc_${id}`, `文章 ${id}`, "正文"),
    reviews: [],
    nodes: [],
    lastActivityAt,
    ...(order === undefined ? {} : { order }),
  };
}

const ids = (list: Project[]) => list.map((p) => p.id);

describe("项目：标题派生", () => {
  it("优先取文档标题", () => {
    expect(deriveProjectTitle(doc("d1", "我的手稿", "anything"))).toBe("我的手稿");
  });

  it("文档标题为空时取正文首段截断", () => {
    expect(deriveProjectTitle(doc("d1", "  ", "Introduction"))).toBe("Introduction");
  });

  it("首段过长截断并加省略号", () => {
    const long = "一".repeat(40);
    const title = deriveProjectTitle(doc("d1", "", long));
    expect(title).toHaveLength(25);
    expect(title.endsWith("…")).toBe(true);
  });

  it("标题与首段都空时给占位", () => {
    expect(deriveProjectTitle(doc("d1", "  ", "   "))).toBe("未命名文章");
  });
});

describe("项目：排序与 upsert", () => {
  const a = proj("a", "2026-09-15T10:00:00.000Z", 0);
  const b = proj("b", "2026-09-15T11:00:00.000Z", 1);
  const c = proj("c", "2026-09-14T09:00:00.000Z", 2);

  it("按显式 order 升序排序，且不改动入参数组", () => {
    const input = [c, a, b];
    const sorted = sortProjects(input);
    expect(ids(sorted)).toEqual(["a", "b", "c"]);
    expect(ids(input)).toEqual(["c", "a", "b"]);
  });

  it("缺 order 的旧数据排到末尾（即使活动时间更新），且不改变相对顺序", () => {
    const legacyNew = proj("z", "2026-09-15T23:00:00.000Z"); // 无 order
    const legacyOld = proj("y", "2026-09-01T00:00:00.000Z"); // 无 order
    const sorted = sortProjects([legacyOld, a, legacyNew]);
    expect(ids(sorted)).toEqual(["a", "z", "y"]);
  });

  it("upsert 已有 id 时覆盖内容但**保持原位置**（顺序不因编辑变化）", () => {
    const updated = { ...a, lastActivityAt: "2026-09-15T13:00:00.000Z" };
    const list = upsertProject([a, b, c], updated);
    expect(ids(list)).toEqual(["a", "b", "c"]);
    expect(list[0].lastActivityAt).toBe("2026-09-15T13:00:00.000Z");
  });

  it("upsert 新 id 时插到最前", () => {
    const list = upsertProject([a, c], b);
    expect(ids(list)).toEqual(["b", "a", "c"]);
    // 新的在最前，于是它的 order 必须小于原有最小值
    expect(list[0].order!).toBeLessThan(Math.min(a.order!, c.order!));
  });

  it("moveProjectToTop 把目标置顶，其余保持相对顺序", () => {
    const list = moveProjectToTop([a, b, c], "c");
    expect(ids(list)).toEqual(["c", "a", "b"]);
    expect(list[0].order!).toBeLessThan(Math.min(a.order!, b.order!));
  });

  it("moveProjectToTop 已在顶部时原样返回（不产生无谓写回）", () => {
    const input = [a, b, c];
    expect(moveProjectToTop(input, "a")).toBe(input);
  });

  it("多次置顶后仍保持「最后置顶的在最前」", () => {
    let list = moveProjectToTop([a, b, c], "c");
    list = moveProjectToTop(list, "b");
    expect(ids(list)).toEqual(["b", "c", "a"]);
    // 排序读回来依然是这个顺序
    expect(ids(sortProjects(list))).toEqual(["b", "c", "a"]);
  });

  it("reorderProjects 按给定 id 顺序重编号为 0..n-1", () => {
    const list = reorderProjects([a, b, c], ["c", "a", "b"]);
    expect(ids(list)).toEqual(["c", "a", "b"]);
    expect(list.map((p) => p.order)).toEqual([0, 1, 2]);
  });

  it("reorderProjects 里漏掉的 id 追加到末尾，不丢条目", () => {
    const list = reorderProjects([a, b, c], ["c"]);
    expect(ids(list)).toEqual(["c", "a", "b"]);
    expect(list).toHaveLength(3);
  });

  it("moveId 移动元素并处理边界", () => {
    expect(moveId(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveId(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveId(["a", "b"], 0, 0)).toEqual(["a", "b"]); // 原地
    expect(moveId(["a", "b"], 0, -1)).toEqual(["a", "b"]); // 越界
    expect(moveId(["a", "b"], 1, 2)).toEqual(["a", "b"]); // 越界
  });
});

describe("拖动让位几何（dragShifts）", () => {
  const H = 60;

  it("没拖动（from 越界）时全为 0", () => {
    expect(dragShifts(3, -1, 0, H, 20)).toEqual([0, 0, 0]);
    expect(dragShifts(3, 5, 0, H, 20)).toEqual([0, 0, 0]);
  });

  it("被拖行位移 = 跟手距离，其余不动（插入位就在原位）", () => {
    // 第 2 行（index 1）拖动，插入位仍是 1 → 落点还是自己
    expect(dragShifts(3, 1, 1, H, 25)).toEqual([0, 25, 0]);
    expect(dragShifts(3, 1, 2, H, 25)).toEqual([0, 25, 0]);
  });

  it("向下拖：中间行整体上移一行（腾出位置）", () => {
    // 第 1 行(index 0) 拖到插入位 3（最末）→ 中间两行各上移一行
    expect(dragShifts(3, 0, 3, H, 130)).toEqual([130, -H, -H]);
  });

  it("向上拖：中间行整体下移一行", () => {
    // 末行(index 2) 拖到插入位 0（最前）→ 前两行各下移一行
    expect(dragShifts(3, 2, 0, H, -130)).toEqual([H, H, -130]);
  });

  it("只跨一格时只有相邻那一行让位", () => {
    expect(dragShifts(4, 1, 3, H, 70)).toEqual([0, 70, -H, 0]);
    expect(dragShifts(4, 2, 1, H, -70)).toEqual([0, H, -70, 0]);
  });

  it("插入位越界时不动其余行，只保留跟手位移", () => {
    // to 落到界外（count 之外）→ 只有被拖行跟着走
    const out = dragShifts(3, 2, 3, H, 10);
    expect(out[2]).toBe(10);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
  });

  it("与 moveId 结果一致：让位后落点等于 moveId 的目标位置", () => {
    // 一致性检查：dragShifts 的落点语义应与 moveId 相同
    for (const [from, to] of [
      [0, 2],
      [2, 0],
      [1, 3],
      [3, 1],
    ]) {
      const ids = ["a", "b", "c", "d"];
      const moved = moveId(ids, from, to);
      const insertAt = to > from ? to + 1 : to; // 反推插入位
      const shifts = dragShifts(4, from, insertAt, H, 0);
      // 让位方向应与元素移动方向一致：向下拖中间行上移、向上拖中间行下移
      if (to > from) {
        for (let i = from + 1; i <= to; i++) expect(shifts[i]).toBe(-H);
      } else {
        for (let i = to; i < from; i++) expect(shifts[i]).toBe(H);
      }
      expect(moved[to]).toBe(ids[from]);
    }
  });
});

describe("项目：相对时间", () => {
  it("一分钟内显示刚刚", () => {
    expect(formatRelativeTime("2026-09-15T11:59:30", NOW)).toBe("刚刚");
  });

  it("一小时内按分钟显示", () => {
    expect(formatRelativeTime("2026-09-15T11:30:00", NOW)).toBe("30 分钟前");
  });

  it("当天显示今天 + 时刻", () => {
    expect(formatRelativeTime("2026-09-15T09:05:00", NOW)).toBe("今天 09:05");
  });

  it("前一天显示昨天 + 时刻", () => {
    expect(formatRelativeTime("2026-09-14T22:10:00", NOW)).toBe("昨天 22:10");
  });

  it("同年更早显示月日", () => {
    expect(formatRelativeTime("2026-03-02T08:00:00", NOW)).toBe("3月2日");
  });

  it("跨年显示年月日", () => {
    expect(formatRelativeTime("2025-12-31T08:00:00", NOW)).toBe("2025年12月31日");
  });

  it("非法时间返回空串而不是 Invalid Date", () => {
    expect(formatRelativeTime("not-a-date", NOW)).toBe("");
  });
});
