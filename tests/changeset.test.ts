import { describe, expect, it } from "vitest";
import {
  computeChangeSetApplication,
  prepareChangeSet,
  rangesOverlap,
  resolveEdit,
} from "@/lib/changeset";
import { createDocument } from "@/lib/revisions";
import type { ChangeSet, ConcreteEdit } from "@/lib/review-schema";

function edit(
  id: string,
  blockId: string,
  original: string,
  replacement: string,
  prefix?: string,
  suffix?: string,
): ConcreteEdit {
  return {
    id,
    blockId,
    original,
    replacement,
    prefix,
    suffix,
    explanation: "",
    status: "pending",
  };
}

function cs(edits: ConcreteEdit[], rev = 0): ChangeSet {
  return { id: "cs1", documentRevision: rev, summary: "s", edits };
}

describe("ChangeSet 预处理与批量应用（PLAN 10.4 / 阶段 4）", () => {
  it("定位每条修改；定位不到的进 rejected", () => {
    const doc = createDocument("t", ["这些结果共同的表明该效应存在。"]);
    const b = doc.blocks[0].id;
    const set = cs([
      edit("e1", b, "共同的表明", "共同表明"),
      edit("e2", b, "不存在的文本", "x"),
      edit("e3", "p_无", "共同的表明", "x"),
    ]);
    const { applicable, rejected } = prepareChangeSet(doc, set);
    expect(applicable.map((r) => r.edit.id)).toEqual(["e1"]);
    expect(rejected.get("e2")).toBe("original_not_found");
    expect(rejected.get("e3")).toBe("block_not_found");
  });

  it("同 block 内重叠修改：保留先到者，其余标 overlap（重点场景 5）", () => {
    const doc = createDocument("t", ["abcdef"]); // 位置: a0 b1 c2 d3 e4 f5
    const b = doc.blocks[0].id;
    const set = cs([
      edit("e1", b, "bcd", "X"), // [1,4)
      edit("e2", b, "cde", "Y"), // [2,5) 与 e1 相交
    ]);
    const { applicable, rejected } = prepareChangeSet(doc, set);
    expect(applicable.map((r) => r.edit.id)).toEqual(["e1"]);
    expect(rejected.get("e2")).toBe("overlap");
  });

  it("同 block 内不重叠的多条修改都被保留", () => {
    const doc = createDocument("t", ["abcdef"]);
    const b = doc.blocks[0].id;
    const set = cs([edit("e1", b, "ab", "X"), edit("e2", b, "ef", "Y")]);
    const { applicable, rejected } = prepareChangeSet(doc, set);
    expect(applicable).toHaveLength(2);
    expect(rejected.size).toBe(0);
  });

  it("批量应用：同段内从后向前替换，偏移不错位（重点场景 6）", () => {
    const doc = createDocument("t", ["the cat sat on the mat"]);
    const b = doc.blocks[0].id;
    // 替换前面的 "the" 和后面的 "mat"，若顺序错会错位
    const set = cs([
      edit("e1", b, "the", "a", undefined, " cat"), // 第一个 the
      edit("e2", b, "mat", "dog"),
    ]);
    const { newTextByBlock, appliedIds } = computeChangeSetApplication(doc, set);
    expect(newTextByBlock.get(b)).toBe("a cat sat on the dog");
    expect(appliedIds.sort()).toEqual(["e1", "e2"]);
  });

  it("撤销快照保存每段原文", () => {
    const doc = createDocument("t", ["hello world", "second para"]);
    const [b1, b2] = doc.blocks.map((x) => x.id);
    const set = cs([
      edit("e1", b1, "world", "there"),
      edit("e2", b2, "second", "2nd"),
    ]);
    const { oldTextByBlock } = computeChangeSetApplication(doc, set);
    expect(oldTextByBlock.get(b1)).toBe("hello world");
    expect(oldTextByBlock.get(b2)).toBe("second para");
  });

  it("跨多段的修改集分别应用", () => {
    const doc = createDocument("t", ["共同的表明", "deception related decision making"]);
    const [b1, b2] = doc.blocks.map((x) => x.id);
    const set = cs([
      edit("e1", b1, "共同的表明", "共同表明"),
      edit("e2", b2, "deception related decision making", "deception-related decision-making"),
    ]);
    const { newTextByBlock } = computeChangeSetApplication(doc, set);
    expect(newTextByBlock.get(b1)).toBe("共同表明");
    expect(newTextByBlock.get(b2)).toBe("deception-related decision-making");
  });

  it("resolveEdit 用 prefix/suffix 消歧（同短语出现两次）", () => {
    const doc = createDocument("t", ["他认为这个方案可行，但我认为这个方案风险太大。"]);
    const b = doc.blocks[0].id;
    const r = resolveEdit(doc, edit("e", b, "这个方案", "X", "但我认为", "风险"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(doc.blocks[0].text.slice(r.start, r.end)).toBe("这个方案");
      expect(r.start).toBeGreaterThan(8);
    }
  });

  it("rangesOverlap 边界：相邻不算相交", () => {
    expect(rangesOverlap(0, 3, 3, 6)).toBe(false); // [0,3) 与 [3,6) 相邻
    expect(rangesOverlap(0, 3, 2, 6)).toBe(true);
    expect(rangesOverlap(2, 4, 0, 3)).toBe(true);
    expect(rangesOverlap(0, 2, 5, 8)).toBe(false);
  });
});
