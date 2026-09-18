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

function makeEditor(getConfig: () => ChangeSetPreviewDecorationConfig) {
  const doc = createDocument("test", ["same first, then same second"]);
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
