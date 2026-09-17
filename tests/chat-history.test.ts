import { describe, expect, it } from "vitest";
import {
  deriveProjectTitle,
  dragShifts,
  dragTargetIndex,
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

  it("文档标题为空时取正文首段", () => {
    expect(deriveProjectTitle(doc("d1", "  ", "Introduction"))).toBe("Introduction");
  });

  it("空格分词文本取前 12 个词并加省略号", () => {
    const paragraph =
      "Deception can be defined as a psychological process in which an individual deliberately attempts to mislead";
    expect(deriveProjectTitle(doc("d1", "", paragraph))).toBe(
      "Deception can be defined as a psychological process in which an individual…",
    );
  });

  it("不超过 12 个词的空格分词文本保持完整", () => {
    expect(deriveProjectTitle(doc("d1", "", "A concise working title"))).toBe(
      "A concise working title",
    );
  });

  it("连续文本过长时取前 24 个字符并加省略号", () => {
    const long = "一".repeat(40);
    const title = deriveProjectTitle(doc("d1", "", long));
    expect(title).toHaveLength(25);
    expect(title.endsWith("…")).toBe(true);
  });

  it("跳过正文开头的空段落", () => {
    const input = doc("d1", "", "   ");
    input.blocks.push({ id: "p_2", type: "paragraph", text: "Actual opening paragraph" });
    expect(deriveProjectTitle(input)).toBe("Actual opening paragraph");
  });

  it("异常长单词受硬上限约束", () => {
    const title = deriveProjectTitle(doc("d1", "", `${"a".repeat(120)} next`));
    expect(Array.from(title)).toHaveLength(97);
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

describe("拖动落点判定（dragTargetIndex）", () => {
  const H = 60;
  // 三行：0..60 / 60..120 / 120..180（列表坐标系）
  const tops = [0, H, 2 * H];

  it("没位移时落点就是原位", () => {
    for (const from of [0, 1, 2]) {
      expect(dragTargetIndex(tops, H, from, 0)).toBe(from);
    }
  });

  it("边缘一接触就让位（不是等中心过半）", () => {
    // 第 1 行(index 0) 下移：底边(0+H+dy)一旦碰到第 2 行顶边(60)就算越过 → 落点 1
    expect(dragTargetIndex(tops, H, 0, 0)).toBe(0); // 还没接触
    expect(dragTargetIndex(tops, H, 0, 1)).toBe(1); // 刚接触就让位
    // 关键：远不到中心（中心过半要 dy≈90）
    expect(dragTargetIndex(tops, H, 0, 1)).toBeLessThan(2);
  });

  it("越过几行就前进几位（向下）", () => {
    expect(dragTargetIndex(tops, H, 0, 1)).toBe(1); // 碰到第 2 行
    expect(dragTargetIndex(tops, H, 0, H + 1)).toBe(2); // 再碰到第 3 行
    expect(dragTargetIndex(tops, H, 0, 999)).toBe(2); // 到底不会越界
  });

  it("向上拖同理（回退几位）", () => {
    expect(dragTargetIndex(tops, H, 2, -1)).toBe(1);
    expect(dragTargetIndex(tops, H, 2, -(H + 1))).toBe(0);
    expect(dragTargetIndex(tops, H, 2, -999)).toBe(0);
  });

  it("接触边界只切一次，不产生中间态（判定读固定快照，无反馈循环）", () => {
    expect(dragTargetIndex(tops, H, 0, -0.1)).toBe(0);
    expect(dragTargetIndex(tops, H, 0, 0)).toBe(0);
    expect(dragTargetIndex(tops, H, 0, 0.1)).toBe(1);
    // 同一个 dy 反复求值结果恒定
    expect(dragTargetIndex(tops, H, 0, 0.1)).toBe(dragTargetIndex(tops, H, 0, 0.1));
  });

  it("行高为 0 或 from 越界时返回原位（防御）", () => {
    expect(dragTargetIndex([], 0, 0, 50)).toBe(0);
    expect(dragTargetIndex(tops, H, -1, 50)).toBe(-1);
    expect(dragTargetIndex(tops, H, 9, 50)).toBe(9);
  });
});

describe("拖动让位几何（dragShifts）", () => {
  const H = 60;
  const GAP = 4;
  const STEP = H + GAP;
  const tops = [0, STEP, 2 * STEP, 3 * STEP];

  it("没拖动（from 越界）时全为 0", () => {
    expect(dragShifts(3, -1, 0, tops, 20)).toEqual([0, 0, 0]);
    expect(dragShifts(3, 5, 0, tops, 20)).toEqual([0, 0, 0]);
  });

  it("落点等于原位时其余行不动，只有被拖行跟手", () => {
    expect(dragShifts(3, 1, 1, tops, 25)).toEqual([0, 25, 0]);
  });

  it("向下拖：中间行整体上移一个完整槽位（包含行间距）", () => {
    expect(dragShifts(3, 0, 2, tops, 130)).toEqual([130, -STEP, -STEP]);
  });

  it("向上拖：中间行整体下移一个完整槽位（包含行间距）", () => {
    expect(dragShifts(3, 2, 0, tops, -130)).toEqual([STEP, STEP, -130]);
  });

  it("跨多格时中间各行都让位（落点是下标，不是插入位）", () => {
    // 从 1 挪到 3：第 3、4 行（原 index 2、3）各上移一行
    expect(dragShifts(4, 1, 3, tops, 70)).toEqual([0, 70, -STEP, -STEP]);
    // 从 2 挪到 1：只有原 index 1 下移一行
    expect(dragShifts(4, 2, 1, tops, -70)).toEqual([0, STEP, -70, 0]);
  });

  it("落点越界时不动其余行，只保留跟手位移", () => {
    const out = dragShifts(3, 2, 3, tops, 10);
    expect(out[2]).toBe(10);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
  });

  it("与 moveId 结果一致：让位后落点等于 moveId 的目标位置", () => {
    for (const [from, to] of [
      [0, 2],
      [2, 0],
      [1, 3],
      [3, 1],
    ]) {
      const ids = ["a", "b", "c", "d"];
      const moved = moveId(ids, from, to);
      const shifts = dragShifts(4, from, to, tops, 0);
      if (to > from) {
        for (let i = from + 1; i <= to; i++) expect(shifts[i]).toBe(-STEP);
      } else {
        for (let i = to; i < from; i++) expect(shifts[i]).toBe(STEP);
      }
      expect(moved[to]).toBe(ids[from]);
    }
  });

  it("落点判定与让位一致：把 dragTargetIndex 的结果喂给 dragShifts，落点行确实让位", () => {
    const targetTops = [0, STEP, 2 * STEP];
    // 第 1 行往下拖一点 → 落点 1 → 第 2 行上移
    const to = dragTargetIndex(targetTops, H, 0, GAP + 1);
    const shifts = dragShifts(3, 0, to, targetTops, GAP + 1);
    expect(to).toBe(1);
    expect(shifts[1]).toBe(-STEP);
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
