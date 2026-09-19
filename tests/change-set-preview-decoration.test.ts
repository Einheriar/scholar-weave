import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { BlockIdExtension } from "@/components/editor/BlockIdExtension";
import {
  ChangeSetPreviewDecorationExtension,
  changeSetPreviewDecorationKey,
  type ChangeSetPreviewDecorationConfig,
} from "@/components/editor/ChangeSetPreviewDecorationExtension";
import { docToTiptap } from "@/lib/tiptap-convert";
import { createDocument } from "@/lib/revisions";
import type { ConcreteEdit } from "@/lib/review-schema";

function makeEditor(
  getConfig: () => ChangeSetPreviewDecorationConfig,
  text = "same first, then same second",
) {
  const doc = createDocument("test", [text]);
  const editor = new Editor({
    element: document.createElement("div"),
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
      ChangeSetPreviewDecorationExtension.configure({ getConfig }),
    ],
    content: docToTiptap(doc),
  });
  return { doc, editor };
}

describe("ChangeSetPreviewDecorationExtension", () => {
  it.each([
    { text: "alpha\nbeta", original: "alpha", prefix: undefined, start: 0 },
    { text: "lead\n\nbeta tail", original: "beta", prefix: undefined, start: 6 },
    { text: "lead\nalpha\n\nbeta tail", original: "alpha\n\nbeta", prefix: undefined, start: 5 },
    { text: "same\nsame", original: "same", prefix: "\n", start: 5 },
    { text: "alpha\nbeta", original: "alphabeta", prefix: undefined, start: null },
  ])("段内换行保留修改预览位置：$text / $original", ({ text, original, prefix, start }) => {
    let cfg: ChangeSetPreviewDecorationConfig = { edit: null };
    const { doc, editor } = makeEditor(() => cfg, text);
    cfg = {
      edit: {
        id: "newline-edit",
        blockId: doc.blocks[0].id,
        original,
        prefix,
        replacement: "revised",
        explanation: "Clarify wording.",
        status: "pending",
      },
    };
    try {
      editor.view.dispatch(editor.state.tr.setMeta(changeSetPreviewDecorationKey, true));
      const decorations = changeSetPreviewDecorationKey.getState(editor.state)!.find();
      if (start === null) {
        expect(decorations).toEqual([]);
      } else {
        expect(decorations).toHaveLength(1);
        expect(decorations[0].from).toBe(start + 1);
        expect(decorations[0].to).toBe(start + 1 + original.length);
        expect(editor.state.doc.textBetween(decorations[0].from, decorations[0].to, " ", "\n"))
          .toBe(original);
      }
    } finally {
      editor.destroy();
    }
  });

  it("使用上下文消歧并只高亮对应的一次出现", () => {
    let cfg: ChangeSetPreviewDecorationConfig = { edit: null };
    const { doc, editor } = makeEditor(() => cfg);
    const edit: ConcreteEdit = {
      id: "edit-second",
      blockId: doc.blocks[0].id,
      original: "same",
      replacement: "different",
      prefix: "then ",
      suffix: " second",
      explanation: "test",
      status: "pending",
    };
    cfg = { edit };
    editor.view.dispatch(
      editor.state.tr.setMeta(changeSetPreviewDecorationKey, true),
    );

    const decorations = changeSetPreviewDecorationKey
      .getState(editor.state)
      ?.find();
    expect(decorations).toHaveLength(1);
    const decoration = decorations?.[0] as unknown as {
      type?: { attrs?: Record<string, string> };
    };
    const attrs = decoration.type?.attrs;
    expect(attrs?.["data-changeset-preview-edit-id"]).toBe(edit.id);
    expect(
      editor.state.doc.textBetween(decorations![0].from, decorations![0].to),
    ).toBe("same");
    editor.destroy();
  });

  it("没有消歧证据且原文重复时不猜测位置", () => {
    let cfg: ChangeSetPreviewDecorationConfig = { edit: null };
    const { doc, editor } = makeEditor(() => cfg);
    cfg = {
      edit: {
        id: "edit-ambiguous",
        blockId: doc.blocks[0].id,
        original: "same",
        replacement: "different",
        explanation: "test",
        status: "pending",
      },
    };
    editor.view.dispatch(
      editor.state.tr.setMeta(changeSetPreviewDecorationKey, true),
    );
    expect(changeSetPreviewDecorationKey.getState(editor.state)?.find()).toEqual(
      [],
    );
    editor.destroy();
  });
});
