import { describe, expect, it } from "vitest";
import {
  deriveProjectTitle,
  formatRelativeTime,
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

function proj(id: string, lastActivityAt: string): Project {
  return {
    id,
    title: `文章 ${id}`,
    doc: doc(`doc_${id}`, `文章 ${id}`, "正文"),
    reviews: [],
    nodes: [],
    lastActivityAt,
  };
}

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
  const a = proj("a", "2026-09-15T10:00:00.000Z");
  const b = proj("b", "2026-09-15T11:00:00.000Z");
  const c = proj("c", "2026-09-14T09:00:00.000Z");

  it("按 lastActivityAt 新到旧排序，且不改动入参数组", () => {
    const input = [a, c, b];
    const sorted = sortProjects(input);
    expect(sorted.map((x) => x.id)).toEqual(["b", "a", "c"]);
    expect(input.map((x) => x.id)).toEqual(["a", "c", "b"]);
  });

  it("upsert 已有 id 时覆盖而不是新增，并重新排序到最前", () => {
    const updated = { ...c, lastActivityAt: "2026-09-15T13:00:00.000Z" };
    const list = upsertProject([b, a, c], updated);
    expect(list).toHaveLength(3);
    expect(list[0].id).toBe("c");
    expect(list[0].lastActivityAt).toBe("2026-09-15T13:00:00.000Z");
  });

  it("upsert 新 id 时插入到正确位置", () => {
    const list = upsertProject([a, c], b);
    expect(list.map((x) => x.id)).toEqual(["b", "a", "c"]);
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
