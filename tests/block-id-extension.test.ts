import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { BlockIdExtension } from "@/components/editor/BlockIdExtension";
import { docToTiptap, tiptapToBlocks } from "@/lib/tiptap-convert";
import { createDocument } from "@/lib/revisions";

function createEditor(texts: string[]): Editor {
  const doc = createDocument("t", texts);
  return new Editor({
    element: globalThis.document.createElement("div"),
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      BlockIdExtension,
    ],
    content: docToTiptap(doc),
  });
}

function blockIds(editor: Editor): string[] {
  return tiptapToBlocks(editor.getJSON() as never).map((b) => b.blockId);
}

describe("BlockIdExtension：编辑器中的稳定段落 ID（PLAN 10.2）", () => {
  it("初始化为每段分配唯一 ID", () => {
    const editor = createEditor(["第一段", "第二段", "第三段"]);
    const ids = blockIds(editor);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    ids.forEach((id) => expect(id).toMatch(/^p_/));
    editor.destroy();
  });

  it("在段中插入文字不改变该段 ID", () => {
    const editor = createEditor(["第一段", "第二段"]);
    const before = blockIds(editor);

    // 把光标放到第一段末尾并插入文字
    editor.commands.focus(4);
    editor.commands.insertContent("x");

    const after = blockIds(editor);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    editor.destroy();
  });

  it("拆分段落：前半段保留原 ID，后半段获得新 ID", () => {
    const editor = createEditor(["前半后半", "第二段"]);
    const before = blockIds(editor);

    // 光标放在“前半|后半”之间（doc 起始 0，第一段内容从 1 开始，2 个字符后 = 3）
    editor.commands.focus(3);
    editor.commands.splitBlock();

    const after = blockIds(editor);
    expect(after).toHaveLength(3);
    expect(after[0]).toBe(before[0]); // 前半段保留 ID
    expect(after[1]).not.toBe(before[0]); // 后半段新 ID
    expect(after[2]).toBe(before[1]); // 第二段不受影响
    editor.destroy();
  });

  it("合并段落：保留目标段 ID，被并入段 ID 消失", () => {
    const editor = createEditor(["第一段", "第二段"]);
    const before = blockIds(editor);

    // ProseMirror 位置：第一段 <p>第一段</p> 占 0..5（1-3 是文本），
    // 第二段文本从 6 开始。把光标放到第二段开头，joinBackward 合并。
    editor.commands.focus(6);
    editor.commands.joinBackward();

    const after = blockIds(editor);
    expect(after).toHaveLength(1);
    expect(after[0]).toBe(before[0]);
    expect(after[0]).not.toBe(before[1]);
    editor.destroy();
  });

  it("连续多次编辑后，未受影响段落的 ID 保持稳定（验收标准）", () => {
    const editor = createEditor(["一", "二", "三"]);
    const before = blockIds(editor);

    // 编辑第一段
    editor.commands.focus(1);
    editor.commands.insertContent("加");
    expect(blockIds(editor)[1]).toBe(before[1]);
    expect(blockIds(editor)[2]).toBe(before[2]);

    // 拆分第二段
    editor.commands.focus(1 + "加一".length + 1 + 1);
    editor.commands.splitBlock();
    const afterSplit = blockIds(editor);
    expect(afterSplit[0]).toBe(before[0]);
    expect(afterSplit[afterSplit.length - 1]).toBe(before[2]);

    editor.destroy();
  });
});
