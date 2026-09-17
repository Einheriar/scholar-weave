import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  docToTiptap,
  tiptapToBlocks,
  type PMDocNode,
} from "@/lib/tiptap-convert";
import { BlockIdExtension } from "@/components/editor/BlockIdExtension";
import { createDocument } from "@/lib/revisions";
import { locateRange } from "@/lib/anchoring";

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

describe("Tiptap hardBreak 与 DocumentState 换行互转", () => {
  it("把 \n 编码为 hardBreak，并在 roundtrip 后保留前后换行", () => {
    const doc = createDocument("t", ["alpha\nbeta\n"]);
    const pm = docToTiptap(doc);

    expect(pm.content[0].content).toEqual([
      { type: "text", text: "alpha" },
      { type: "hardBreak" },
      { type: "text", text: "beta" },
      { type: "hardBreak" },
    ]);
    expect(tiptapToBlocks(pm)[0].text).toBe("alpha\nbeta\n");
  });

  it("读取含 hardBreak 的 PM JSON 时还原为单个 block 内的换行", () => {
    const doc: PMDocNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { blockId: "p_test" },
          content: [
            { type: "text", text: "one" },
            { type: "hardBreak" },
            { type: "text", text: "two" },
          ],
        },
      ],
    };
    expect(tiptapToBlocks(doc)).toEqual([
      { blockId: "p_test", text: "one\ntwo" },
    ]);
  });

  it("换行后的锚点偏移与 PM hardBreak 位置一致", () => {
    const document = createDocument("t", ["first\nsecond"]);
    const blockId = document.blocks[0].id;
    const scope = {
      type: "range" as const,
      blockId,
      original: "second",
      prefix: "\n",
    };
    const hit = locateRange(document, scope);
    if (!hit.ok) throw new Error(`anchor lookup failed: ${hit.reason}`);
    expect(hit).toMatchObject({ ok: true, start: 6, end: 12 });

    const editor = createEditor(["first\nsecond"]);
    // 段落内容从 PM 位置 1 开始，hardBreak 占一个 inline 位置。
    editor.commands.insertContentAt(
      { from: 1 + hit.start, to: 1 + hit.end },
      "changed",
    );
    expect(tiptapToBlocks(editor.getJSON() as PMDocNode)[0].text).toBe(
      "first\nchanged",
    );
    editor.destroy();
  });
});
