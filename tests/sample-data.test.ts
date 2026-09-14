import { describe, expect, it } from "vitest";
import { buildSampleDocument, buildSampleReview } from "@/lib/sample-data";
import { canLocateScope, locateRange } from "@/lib/anchoring";
import type { ReviewScope } from "@/lib/review-schema";

describe("阶段 2 假数据：所有可执行建议的锚点必须能定位", () => {
  const { doc } = buildSampleDocument();
  const items = buildSampleReview(doc);

  it("样例文档包含 5 个段落", () => {
    expect(doc.blocks).toHaveLength(5);
  });

  it("每条 edit 建议的 range scope 都能在当前文档中唯一定位", () => {
    const edits = items.filter((i) => i.kind === "edit" && i.status !== "stale");
    expect(edits.length).toBeGreaterThan(0);
    for (const item of edits) {
      const scope = item.scope as Extract<ReviewScope, { type: "range" }>;
      const r = locateRange(doc, scope);
      expect(
        r.ok,
        `锚点应可定位：${item.id} (${item.title}) — ${JSON.stringify(r)}`,
      ).toBe(true);
      if (r.ok) {
        // 定位到的文本应逐字等于 original
        const text = doc.blocks.find((b) => b.id === scope.blockId)!.text;
        expect(text.slice(r.start, r.end)).toBe(scope.original);
      }
    }
  });

  it("opinion 建议可定位（document/block 级只检查存在性）", () => {
    for (const item of items.filter((i) => i.kind === "opinion")) {
      expect(canLocateScope(doc, item.scope), item.id).toBe(true);
    }
  });

  it("stale 示例建议无法定位（符合其过期语义）", () => {
    const stale = items.find((i) => i.status === "stale")!;
    const scope = stale.scope as Extract<ReviewScope, { type: "range" }>;
    expect(locateRange(doc, scope).ok).toBe(false);
  });

  it("三层范围与两类建议都被覆盖", () => {
    const scopes = new Set(items.map((i) => i.scope.type));
    const kinds = new Set(items.map((i) => i.kind));
    expect(scopes).toEqual(new Set(["document", "block", "range"]));
    expect(kinds).toEqual(new Set(["opinion", "edit"]));
  });
});
