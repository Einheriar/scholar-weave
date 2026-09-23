import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ChangeSetPreview } from "@/components/review/ChangeSetPreview";
import type { ChangeSet, DocumentState } from "@/lib/review-schema";

const doc: DocumentState = {
  id: "doc-1",
  title: "测试",
  blocks: [{ id: "block-1", type: "paragraph", text: "Hello world" }],
  revision: 1,
  checksum: "checksum-1",
  updatedAt: "2026-09-17T00:00:00.000Z",
};

const changeSet: ChangeSet = {
  id: "changeset-1",
  documentRevision: 1,
  summary: "修正拼写",
  edits: [
    {
      id: "edit-1",
      blockId: "block-1",
      original: "world",
      replacement: "World",
      explanation: "首字母大写",
      status: "pending",
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ChangeSetPreview 新增内容展示", () => {
  function preview(original: string, replacement: string) {
    const edit = { ...changeSet.edits[0], original, replacement };
    const onAccept = vi.fn(() => true);
    const onRevealEdit = vi.fn();
    const view = render(
      <ChangeSetPreview
        changeSet={{ ...changeSet, edits: [edit] }}
        document={{ ...doc, blocks: [{ ...doc.blocks[0], text: original }] }}
        onAccept={onAccept}
        onDiscard={() => {}}
        open
        onClosed={() => {}}
        onPreviewEditChange={() => {}}
        onRevealEdit={onRevealEdit}
      />,
    );
    return { ...view, edit, onAccept, onRevealEdit };
  }

  it.each([
    ["after", "The sample was assessed.", "The sample was assessed.\nWe retained 27 reports.", "\nWe retained 27 reports.", "之后"],
    ["before", "保留原句。", "新增一句。 保留原句。", "新增一句。 ", "之前"],
  ])("%s：保留原文，仅突出新增文本，定位与接受仍使用原 edit", (position, original, replacement, added, label) => {
    const view = preview(original, replacement);
    const row = view.container.querySelector(`[data-change-addition="${position}"]`)!;
    expect(row).toBeInTheDocument();
    expect(view.getByText(`新增 · 在以下原文${label}`)).toBeInTheDocument();
    expect(view.getByText("原文（保留）")).toBeInTheDocument();
    const originalElement = row.querySelector("[data-change-original]")!;
    const addedElement = row.querySelector("[data-change-replacement]")!;
    expect(originalElement.textContent).toBe(original);
    expect(originalElement).not.toHaveClass("line-through");
    expect(addedElement.textContent).toBe(added);
    expect(Boolean(originalElement.compareDocumentPosition(addedElement) & Node.DOCUMENT_POSITION_FOLLOWING))
      .toBe(position === "after");

    fireEvent.click(view.getByRole("button", { name: "定位修改：首字母大写" }));
    expect(view.onRevealEdit).toHaveBeenCalledWith(view.edit);
    fireEvent.click(view.getByRole("button", { name: "接受选中（1）" }));
    expect(view.onAccept).toHaveBeenCalledWith([view.edit.id]);
  });

  it.each([
    ["改写并新增", "A sentence.", "A revised sentence. More text."],
    ["删除", "A sentence.", ""],
    ["无变化", "A sentence.", "A sentence."],
    ["插在锚点内部", "First. Last.", "First. Added. Last."],
    ["前后位置有歧义", "Again.", "Again.Again."],
  ])("%s：仍显示完整原文与改文，不误标为前后新增", (_label, original, replacement) => {
    const view = preview(original, replacement);
    expect(view.container.querySelector("[data-change-addition]")).toBeNull();
    expect(view.container.querySelector("[data-change-original]")).toHaveClass("line-through");
    expect(view.container.querySelector("[data-change-replacement]")?.textContent).toBe(replacement);
  });
});

describe("ChangeSetPreview 关闭收尾", () => {
  it("没有 animationend 时也会通过兜底定时器卸载", () => {
    vi.useFakeTimers();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    const onClosed = vi.fn();
    const view = render(
      <ChangeSetPreview
        changeSet={changeSet}
        document={doc}
        onAccept={() => true}
        onDiscard={() => {}}
        open
        onClosed={onClosed}
        onPreviewEditChange={() => {}}
        onRevealEdit={() => {}}
      />,
    );

    act(() => {
      view.rerender(
        <ChangeSetPreview
          changeSet={changeSet}
          document={doc}
          onAccept={() => true}
          onDiscard={() => {}}
          open={false}
          onClosed={onClosed}
          onPreviewEditChange={() => {}}
          onRevealEdit={() => {}}
        />,
      );
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("悬停时联动正文高亮，点击时请求定位并保持当前项", () => {
    const onPreviewEditChange = vi.fn();
    const onRevealEdit = vi.fn();
    const view = render(
      <ChangeSetPreview
        changeSet={changeSet}
        document={doc}
        onAccept={() => true}
        onDiscard={() => {}}
        open
        onClosed={() => {}}
        onPreviewEditChange={onPreviewEditChange}
        onRevealEdit={onRevealEdit}
      />,
    );

    const locate = view.getByRole("button", { name: "定位修改：首字母大写" });
    const row = locate.closest("li")!;
    fireEvent.pointerEnter(row);
    expect(onPreviewEditChange).toHaveBeenLastCalledWith(changeSet.edits[0]);

    fireEvent.click(locate);
    expect(onRevealEdit).toHaveBeenCalledWith(changeSet.edits[0]);
    expect(locate).toHaveAttribute("aria-pressed", "true");
  });

  it("接受成功后的退出帧不会用新正文误报原文定位失败", () => {
    const view = render(
      <ChangeSetPreview
        changeSet={changeSet}
        document={doc}
        onAccept={() => true}
        onDiscard={() => {}}
        open
        onClosed={() => {}}
        onPreviewEditChange={() => {}}
        onRevealEdit={() => {}}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "全部接受（1）" }));
    view.rerender(
      <ChangeSetPreview
        changeSet={changeSet}
        document={{
          ...doc,
          blocks: [{ ...doc.blocks[0], text: "Hello World" }],
          revision: 2,
          checksum: "checksum-2",
        }}
        onAccept={() => true}
        onDiscard={() => {}}
        open={false}
        onClosed={() => {}}
        onPreviewEditChange={() => {}}
        onRevealEdit={() => {}}
      />,
    );

    expect(view.queryByText(/以下 1 条无法应用/)).not.toBeInTheDocument();
    expect(view.getByRole("button", { name: "全部接受（1）" })).toBeInTheDocument();
  });
});
