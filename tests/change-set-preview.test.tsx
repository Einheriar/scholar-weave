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
        onAccept={() => {}}
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
          onAccept={() => {}}
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
        onAccept={() => {}}
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
});
