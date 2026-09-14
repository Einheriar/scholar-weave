import { describe, expect, it } from "vitest";
import {
  computeChecksum,
  createDocument,
  insertBlockAfter,
  isRevisionCompatible,
  mergeBlocks,
  removeBlock,
  replaceAllBlocks,
  splitBlock,
  updateBlockText,
} from "@/lib/revisions";

describe("文档模型与稳定段落 ID（PLAN 阶段 1 / 10.2）", () => {
  it("创建文档时每段获得稳定且唯一的 ID，revision 从 0 开始", () => {
    const doc = createDocument("测试", ["第一段", "第二段", "第三段"]);
    expect(doc.revision).toBe(0);
    expect(doc.blocks).toHaveLength(3);
    const ids = doc.blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(3);
    ids.forEach((id) => expect(id).toMatch(/^p_/));
    expect(doc.checksum).toBe(computeChecksum(doc.blocks));
  });

  it("普通文字编辑不改变该段 ID，但会推进 revision 和 checksum", () => {
    const doc = createDocument("t", ["原文", "另一段"]);
    const id = doc.blocks[0].id;
    const checksumBefore = doc.checksum;

    const next = updateBlockText(doc, id, "修改后的原文");

    expect(next.blocks[0].id).toBe(id);
    expect(next.blocks[0].text).toBe("修改后的原文");
    expect(next.revision).toBe(doc.revision + 1);
    expect(next.checksum).not.toBe(checksumBefore);
    // 未受影响的段落 ID 与内容都不变
    expect(next.blocks[1]).toEqual(doc.blocks[1]);
  });

  it("拆分保留前半段 ID，后半段获得新 ID", () => {
    const doc = createDocument("t", ["前半后半", "第二段"]);
    const firstId = doc.blocks[0].id;

    const next = splitBlock(doc, firstId, 2);

    expect(next.blocks).toHaveLength(3);
    expect(next.blocks[0].id).toBe(firstId);
    expect(next.blocks[0].text).toBe("前半");
    expect(next.blocks[1].text).toBe("后半");
    expect(next.blocks[1].id).not.toBe(firstId);
    // 原有第二段不受影响
    expect(next.blocks[2]).toEqual(doc.blocks[1]);
  });

  it("合并保留目标段 ID，被并入段的 ID 消失", () => {
    const doc = createDocument("t", ["第一段", "第二段", "第三段"]);
    const [a, b, c] = doc.blocks.map((x) => x.id);

    const next = mergeBlocks(doc, a, b);

    expect(next.blocks).toHaveLength(2);
    expect(next.blocks[0].id).toBe(a);
    expect(next.blocks[0].text).toBe("第一段第二段");
    expect(next.blocks.some((x) => x.id === b)).toBe(false);
    expect(next.blocks[1].id).toBe(c);
  });

  it("删除段落后其 ID 消失，其余段落 ID 不变", () => {
    const doc = createDocument("t", ["一", "二", "三"]);
    const [a, b, c] = doc.blocks.map((x) => x.id);

    const next = removeBlock(doc, b);

    expect(next.blocks.map((x) => x.id)).toEqual([a, c]);
  });

  it("插入新段落只影响 revision，不改变已有段落 ID", () => {
    const doc = createDocument("t", ["一", "二"]);
    const [a, b] = doc.blocks.map((x) => x.id);

    const next = insertBlockAfter(doc, a, "中间插入");

    expect(next.blocks.map((x) => x.id)).toHaveLength(3);
    expect(next.blocks[0].id).toBe(a);
    expect(next.blocks[2].id).toBe(b);
    expect(next.blocks[1].text).toBe("中间插入");
  });

  it("整体替换（粘贴全文）会为所有段落分配新 ID", () => {
    const doc = createDocument("t", ["旧一", "旧二"]);
    const oldIds = doc.blocks.map((x) => x.id);

    const next = replaceAllBlocks(doc, ["新一", "新二", "新三"]);

    expect(next.blocks).toHaveLength(3);
    next.blocks.forEach((b) => expect(oldIds).not.toContain(b.id));
  });

  it("对不存在的 block 操作是无害的（返回原文档）", () => {
    const doc = createDocument("t", ["一"]);
    expect(updateBlockText(doc, "p_不存在", "x")).toBe(doc);
    expect(splitBlock(doc, "p_不存在", 0)).toBe(doc);
    expect(mergeBlocks(doc, "p_不存在", doc.blocks[0].id)).toBe(doc);
    expect(removeBlock(doc, "p_不存在")).toBe(doc);
  });

  it("版本校验：revision 与 checksum 都一致才兼容（PLAN 10.5）", () => {
    const doc = createDocument("t", ["一"]);
    const { revision, checksum } = doc;

    expect(isRevisionCompatible(doc, revision, checksum)).toBe(true);

    const edited = updateBlockText(doc, doc.blocks[0].id, "改动");
    expect(isRevisionCompatible(edited, revision, checksum)).toBe(false);
    // 即使 revision 碰巧相同，checksum 不同也不兼容
    expect(isRevisionCompatible(edited, revision, edited.checksum)).toBe(false);
  });

  it("支持 Emoji、特殊空格与中英文标点的内容", () => {
    const text = "包含 emoji 😀、全角空格　、不间断空格 、中文标点“”，的段落";
    const doc = createDocument("t", [text]);
    expect(doc.blocks[0].text).toBe(text);
    // 编辑后仍逐字一致
    const next = updateBlockText(doc, doc.blocks[0].id, text + "。");
    expect(next.blocks[0].text.endsWith("。")).toBe(true);
  });
});
