import { describe, expect, it } from "vitest";
import {
  deriveConversationTitle,
  formatRelativeTime,
  sortConversations,
  upsertConversation,
} from "@/lib/chat-history";
import type { ChatTurn, Conversation } from "@/lib/review-schema";

const NOW = new Date("2026-09-15T12:00:00");

function conv(id: string, updatedAt: string, turns: ChatTurn[] = []): Conversation {
  return {
    id,
    title: `对话 ${id}`,
    turns,
    createdAt: updatedAt,
    updatedAt,
  };
}

describe("对话历史：标题派生", () => {
  it("取首条用户消息当标题", () => {
    const turns: ChatTurn[] = [
      { role: "assistant", content: "我先说话（异常情况）" },
      { role: "user", content: "帮我看看这段逻辑" },
    ];
    expect(deriveConversationTitle(turns)).toBe("帮我看看这段逻辑");
  });

  it("把换行与连续空白压成单行", () => {
    const turns: ChatTurn[] = [
      { role: "user", content: "第一行\n\n  第二行\t内容" },
    ];
    expect(deriveConversationTitle(turns)).toBe("第一行 第二行 内容");
  });

  it("过长标题截断并加省略号", () => {
    const long = "一".repeat(40);
    const title = deriveConversationTitle([{ role: "user", content: long }]);
    expect(title).toHaveLength(25);
    expect(title.endsWith("…")).toBe(true);
  });

  it("没有用户消息时给占位标题", () => {
    expect(deriveConversationTitle([])).toBe("新对话");
    expect(deriveConversationTitle([{ role: "assistant", content: "嗨" }])).toBe(
      "新对话",
    );
    expect(deriveConversationTitle([{ role: "user", content: "   " }])).toBe(
      "新对话",
    );
  });
});

describe("对话历史：排序与 upsert", () => {
  const a = conv("a", "2026-09-15T10:00:00.000Z");
  const b = conv("b", "2026-09-15T11:00:00.000Z");
  const c = conv("c", "2026-09-14T09:00:00.000Z");

  it("按 updatedAt 新到旧排序，且不改动入参数组", () => {
    const input = [a, c, b];
    const sorted = sortConversations(input);
    expect(sorted.map((x) => x.id)).toEqual(["b", "a", "c"]);
    expect(input.map((x) => x.id)).toEqual(["a", "c", "b"]);
  });

  it("upsert 已有 id 时覆盖而不是新增，并重新排序到最前", () => {
    const updated = { ...c, updatedAt: "2026-09-15T13:00:00.000Z" };
    const list = upsertConversation([b, a, c], updated);
    expect(list).toHaveLength(3);
    expect(list[0].id).toBe("c");
    expect(list[0].updatedAt).toBe("2026-09-15T13:00:00.000Z");
  });

  it("upsert 新 id 时插入到正确位置", () => {
    const list = upsertConversation([a, c], b);
    expect(list.map((x) => x.id)).toEqual(["b", "a", "c"]);
  });
});

describe("对话历史：相对时间", () => {
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
