import { describe, expect, it } from "vitest";
import {
  applyReplacement,
  canLocateScope,
  locateRange,
} from "@/lib/anchoring";
import { createDocument, updateBlockText } from "@/lib/revisions";
import type { ReviewScope } from "@/lib/review-schema";

function rangeScope(
  blockId: string,
  original: string,
  prefix?: string,
  suffix?: string,
): Extract<ReviewScope, { type: "range" }> {
  return { type: "range", blockId, original, prefix, suffix };
}

describe("锚点定位（PLAN 10.1 / 10.3）", () => {
  it("唯一定位一个 range", () => {
    const doc = createDocument("t", ["这些结果共同的表明该效应存在。"]);
    const r = locateRange(doc, rangeScope(doc.blocks[0].id, "共同的表明"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.start).toBe(4);
      expect(r.end).toBe(9);
    }
  });

  it("original 不存在时返回 original_not_found，绝不猜测位置", () => {
    const doc = createDocument("t", ["这些结果共同表明该效应存在。"]);
    const r = locateRange(doc, rangeScope(doc.blocks[0].id, "共同的表明"));
    expect(r).toMatchObject({ ok: false, reason: "original_not_found" });
  });

  it("block 不存在时返回 block_not_found", () => {
    const doc = createDocument("t", ["一"]);
    const r = locateRange(doc, rangeScope("p_不存在", "任意"));
    expect(r).toMatchObject({ ok: false, reason: "block_not_found" });
  });

  it("同一短语出现两次：用 prefix/suffix 消歧（重点场景 1）", () => {
    const doc = createDocument("t", ["他认为这个方案可行，但我认为这个方案风险太大。"]);
    const id = doc.blocks[0].id;

    // 不给上下文 → 歧义
    const ambiguous = locateRange(doc, rangeScope(id, "这个方案"));
    expect(ambiguous).toMatchObject({ ok: false, reason: "ambiguous" });

    // 给上下文 → 唯一定位到第二处
    const r = locateRange(doc, rangeScope(id, "这个方案", "但我认为", "风险太大"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(doc.blocks[0].text.slice(r.start, r.end)).toBe("这个方案");
      expect(r.start).toBeGreaterThan(10);
    }
  });

  it("唯一命中但上下文不吻合 → context_mismatch（说明文本已变化）", () => {
    const doc = createDocument("t", ["这些结果共同的表明该效应存在。"]);
    const r = locateRange(
      doc,
      rangeScope(doc.blocks[0].id, "共同的表明", "错误的前缀"),
    );
    expect(r).toMatchObject({ ok: false, reason: "context_mismatch" });
  });

  it("original 非逐字一致（LLM 改了字）→ 定位失败（重点场景 3）", () => {
    const doc = createDocument("t", ["这些结果共同的表明该效应存在。"]);
    const r = locateRange(doc, rangeScope(doc.blocks[0].id, "共同地表明"));
    expect(r.ok).toBe(false);
  });

  it("Emoji 与特殊空格按 UTF-16 偏移逐字处理（重点场景 2）", () => {
    const text = "前缀😀　目标词 后缀";
    const doc = createDocument("t", [text]);
    const r = locateRange(doc, rangeScope(doc.blocks[0].id, "目标词"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(text.slice(r.start, r.end)).toBe("目标词");
    }
  });

  it("请求未完成时用户改了段落：重新定位会失败 → 调用方应标记 stale（重点场景 4）", () => {
    const doc = createDocument("t", ["这些结果共同的表明该效应存在。"]);
    const id = doc.blocks[0].id;
    const scope = rangeScope(id, "共同的表明");

    expect(locateRange(doc, scope).ok).toBe(true);

    // 用户删掉了那个多余的“的”
    const edited = updateBlockText(doc, id, "这些结果共同表明该效应存在。");
    expect(locateRange(edited, scope).ok).toBe(false);
    expect(canLocateScope(edited, scope)).toBe(false);
  });

  it("applyReplacement 只改变目标范围", () => {
    const text = "这些结果共同的表明该效应存在。";
    const doc = createDocument("t", [text]);
    const r = locateRange(doc, rangeScope(doc.blocks[0].id, "共同的表明"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const out = applyReplacement(text, r.start, r.end, "共同表明");
      expect(out).toBe("这些结果共同表明该效应存在。");
    }
  });

  it("canLocateScope：document 恒可定位，block 检查存在性", () => {
    const doc = createDocument("t", ["一"]);
    expect(canLocateScope(doc, { type: "document" })).toBe(true);
    expect(
      canLocateScope(doc, { type: "block", blockId: doc.blocks[0].id }),
    ).toBe(true);
    expect(canLocateScope(doc, { type: "block", blockId: "p_无" })).toBe(false);
  });
});
