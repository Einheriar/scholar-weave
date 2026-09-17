import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
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
        />,
      );
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onClosed).toHaveBeenCalledTimes(1);
  });
});
