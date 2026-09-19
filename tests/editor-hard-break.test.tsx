import { createRef } from "react";
import type { Editor } from "@tiptap/react";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  DocumentEditor,
  type DocumentEditorHandle,
} from "@/components/editor/DocumentEditor";
import { createChatRangeLocator } from "@/lib/chat-range-anchor";
import { createDocument } from "@/lib/revisions";
import type { ChatNode, ConcreteEdit, ReviewItem } from "@/lib/review-schema";

function editorFrom(container: HTMLElement): Editor {
  // Tiptap exposes its live editor on the mounted ProseMirror element.
  return (container.querySelector(".ProseMirror") as HTMLElement & { editor: Editor }).editor;
}

describe("DocumentEditor hardBreak coordinates", () => {
  it("highlights and reveals the exact review and preview text after multiple hard breaks", async () => {
    const doc = createDocument("t", ["first\n\nsecond tail"]);
    const ref = createRef<DocumentEditorHandle>();
    const item: ReviewItem = {
      id: "review-after-break",
      documentRevision: doc.revision,
      scope: { type: "range", blockId: doc.blocks[0].id, original: "second", prefix: "\n\n" },
      kind: "edit",
      category: "grammar",
      severity: "suggestion",
      title: "test",
      explanation: "test",
      replacement: "changed",
      status: "open",
    };
    const edit: ConcreteEdit = {
      id: "preview-after-break",
      blockId: doc.blocks[0].id,
      original: "second",
      prefix: "\n\n",
      replacement: "changed",
      explanation: "test",
      status: "pending",
    };
    const { container } = render(
      <DocumentEditor ref={ref} document={doc} onDocumentChange={() => {}} reviewItems={[item]} />,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-review-id="review-after-break"]')?.textContent).toBe("second");
    });
    act(() => ref.current!.revealItem(item));
    expect(editorFrom(container).state.selection.from).toBe(8);
    expect(editorFrom(container).state.selection.to).toBe(14);

    act(() => {
      ref.current!.previewChangeSetEdit(edit);
      expect(ref.current!.revealChangeSetEdit(edit)).toBe(true);
    });
    await waitFor(() => {
      expect(container.querySelector('[data-changeset-preview-edit-id="preview-after-break"]')?.textContent).toBe("second");
    });
  });

  it("reports a real cross-break selection with newline text and matching local evidence", () => {
    const text = "first\nsecond tail";
    const doc = createDocument("t", [text]);
    const ref = createRef<DocumentEditorHandle>();
    const onSelectionChange = vi.fn();
    const node: ChatNode = {
      id: "cross-break",
      anchor: { type: "range", blockId: doc.blocks[0].id, selectedText: "st\nsec" },
      originalText: "st\nsec",
      createdAt: doc.updatedAt,
      turns: [],
    };
    const { container } = render(
      <DocumentEditor ref={ref} document={doc} onDocumentChange={() => {}} onSelectionChange={onSelectionChange} />,
    );
    act(() => expect(ref.current!.revealChatAnchor(node)).toBe(true));
    expect(editorFrom(container).state.selection.from).toBe(4);
    expect(editorFrom(container).state.selection.to).toBe(10);
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      blockId: doc.blocks[0].id,
      text: "st\nsec",
      rangeLocator: { start: 3, end: 9, prefix: "fir", suffix: "ond tail", blockText: text },
    });
  });

  it("maps a chat range past hard breaks when a real text transaction inserts before it", () => {
    const text = "first\nsecond tail";
    const doc = createDocument("t", [text]);
    const onChatRangeLocatorsChange = vi.fn();
    const node: ChatNode = {
      id: "mapped-after-break",
      anchor: { type: "range", blockId: doc.blocks[0].id, selectedText: "second" },
      rangeLocator: createChatRangeLocator(text, 6, 12)!,
      originalText: "second",
      createdAt: doc.updatedAt,
      turns: [],
    };
    const { container } = render(
      <DocumentEditor document={doc} onDocumentChange={() => {}} chatNodes={[node]} onChatRangeLocatorsChange={onChatRangeLocatorsChange} />,
    );
    const editor = editorFrom(container);
    act(() => editor.view.dispatch(editor.state.tr.insertText("new ", 7)));
    expect(onChatRangeLocatorsChange).toHaveBeenLastCalledWith([{
      nodeId: node.id,
      rangeLocator: {
        start: 10,
        end: 16,
        prefix: "first\nnew ",
        suffix: " tail",
        blockText: "first\nnew second tail",
      },
    }]);
  });

  it("applies and reverts a cross-break review without changing neighboring text or block identity", () => {
    const text = "first\nsecond tail";
    const doc = createDocument("t", [text]);
    const ref = createRef<DocumentEditorHandle>();
    let latest = doc;
    const item: ReviewItem = {
      id: "cross-break-edit",
      documentRevision: doc.revision,
      scope: { type: "range", blockId: doc.blocks[0].id, original: "st\nsec", prefix: "fir", suffix: "ond tail" },
      kind: "edit",
      category: "grammar",
      severity: "suggestion",
      title: "test",
      explanation: "test",
      replacement: "X\nY\nZ",
      status: "open",
    };
    render(<DocumentEditor ref={ref} document={doc} onDocumentChange={(next) => { latest = next; }} />);
    act(() => expect(ref.current!.applyEdit(item)).toBe(true));
    expect(latest.blocks).toEqual([{ ...doc.blocks[0], text: "firX\nY\nZond tail" }]);
    act(() => expect(ref.current!.revertEdit(item)).toBe(true));
    expect(latest.blocks).toEqual(doc.blocks);
  });
});
