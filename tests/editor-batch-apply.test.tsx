import { describe, expect, it } from "vitest";
import { createRef } from "react";
import { render, waitFor } from "@testing-library/react";
import {
  DocumentEditor,
  type DocumentEditorHandle,
} from "@/components/editor/DocumentEditor";
import { createDocument } from "@/lib/revisions";
import { tiptapToBlocks } from "@/lib/tiptap-convert";
import type { DocumentState } from "@/lib/review-schema";
import type { PMDocNode } from "@/lib/tiptap-convert";
import type { ReviewItem } from "@/lib/review-schema";

/**
 * 编辑器级批量应用与撤销（PLAN 10.4 / 阶段 4 验收）。
 * 通过 DocumentEditorHandle 在真实 Tiptap 实例上验证：
 * - applyBlockTexts 批量替换多段且保留 blockId；
 * - revertBlockTexts 能逐字还原（撤销）；
 * - 未受影响的段落不变。
 */

function setup(initial: string[]) {
  const doc = createDocument("t", initial);
  const ref = createRef<DocumentEditorHandle>();
  let latest: DocumentState = doc;
  render(
    <DocumentEditor
      ref={ref}
      document={doc}
      onDocumentChange={(d) => {
        latest = d;
      }}
    />,
  );
  return { doc, ref, getLatest: () => latest };
}

describe("DocumentEditor 批量应用与撤销（阶段 4）", () => {
  it("readOnly 会同步到 Tiptap，禁止输入但保留编辑器内容", async () => {
    const doc = createDocument("t", ["locked"]);
    const { container, rerender } = render(
      <DocumentEditor
        document={doc}
        onDocumentChange={() => {}}
        readOnly={false}
      />,
    );
    const editor = () => container.querySelector(".ProseMirror")!;
    await waitFor(() => expect(editor()).toHaveAttribute("contenteditable", "true"));

    rerender(
      <DocumentEditor
        document={doc}
        onDocumentChange={() => {}}
        readOnly
      />,
    );
    await waitFor(() => expect(editor()).toHaveAttribute("contenteditable", "false"));
  });

  it("range edit 可在换行 block 中应用并安全撤销", async () => {
    const original = "first\nsecond";
    const { doc, ref, getLatest } = setup([original]);
    const blockId = doc.blocks[0].id;
    const item: ReviewItem = {
      id: "review-newline",
      documentRevision: doc.revision,
      scope: {
        type: "range",
        blockId,
        original: "second",
        prefix: "\n",
      },
      kind: "edit",
      category: "grammar",
      severity: "suggestion",
      title: "test",
      explanation: "test",
      replacement: "<b>changed</b>\nnext",
      status: "open",
    };

    expect(ref.current!.applyEdit(item)).toBe(true);
    await waitFor(() =>
      expect(getLatest().blocks[0].text).toBe("first\n<b>changed</b>\nnext"),
    );
    expect(ref.current!.revertEdit(item)).toBe(true);
    await waitFor(() => expect(getLatest().blocks[0].text).toBe(original));
  });

  it("正文已改动导致 replacement 无法唯一定位时拒绝安全撤销", async () => {
    const { doc, ref, getLatest } = setup(["hello world."]);
    const blockId = doc.blocks[0].id;
    const item: ReviewItem = {
      id: "review-unsafe-revert",
      documentRevision: doc.revision,
      scope: { type: "range", blockId, original: "world", suffix: "." },
      kind: "edit",
      category: "grammar",
      severity: "suggestion",
      title: "test",
      explanation: "test",
      replacement: "earth",
      status: "open",
    };

    expect(ref.current!.applyEdit(item)).toBe(true);
    await waitFor(() => expect(getLatest().blocks[0].text).toBe("hello earth."));
    // 用户把 replacement 改成了更长的词，原 scope 上下文不再吻合。
    expect(ref.current!.applyBlockTexts(new Map([[blockId, "hello earthly."]]))).toBe(true);
    await waitFor(() => expect(getLatest().blocks[0].text).toBe("hello earthly."));
    expect(ref.current!.revertEdit(item)).toBe(false);
    expect(getLatest().blocks[0].text).toBe("hello earthly.");
  });

  it("replacement 为空时可用上下文唯一定位插入点", async () => {
    const { doc, ref, getLatest } = setup(["aBADb"]);
    const blockId = doc.blocks[0].id;
    const item: ReviewItem = {
      id: "review-empty-replacement",
      documentRevision: doc.revision,
      scope: { type: "range", blockId, original: "BAD", prefix: "a", suffix: "b" },
      kind: "edit",
      category: "style",
      severity: "suggestion",
      title: "test",
      explanation: "test",
      replacement: "",
      status: "open",
    };

    expect(ref.current!.applyEdit(item)).toBe(true);
    await waitFor(() => expect(getLatest().blocks[0].text).toBe("ab"));
    expect(ref.current!.revertEdit(item)).toBe(true);
    await waitFor(() => expect(getLatest().blocks[0].text).toBe("aBADb"));
  });

  it("block edit 仅在整段仍等于接受后文本时使用持久化快照撤销", async () => {
    const { doc, ref, getLatest } = setup(["before"]);
    const blockId = doc.blocks[0].id;
    const item: ReviewItem = {
      id: "review-block-revert",
      documentRevision: doc.revision,
      scope: { type: "block", blockId },
      kind: "edit",
      category: "clarity",
      severity: "suggestion",
      title: "test",
      explanation: "test",
      replacement: "after",
      status: "accepted",
      acceptedSnapshot: { before: "before", after: "after" },
    };

    expect(ref.current!.applyEdit(item)).toBe(true);
    await waitFor(() => expect(getLatest().blocks[0].text).toBe("after"));
    expect(ref.current!.revertEdit(item)).toBe(true);
    await waitFor(() => expect(getLatest().blocks[0].text).toBe("before"));

    expect(ref.current!.applyBlockTexts(new Map([[blockId, "after plus user edit"]]))).toBe(true);
    await waitFor(() => expect(getLatest().blocks[0].text).toBe("after plus user edit"));
    expect(ref.current!.revertEdit(item)).toBe(false);
    expect(getLatest().blocks[0].text).toBe("after plus user edit");
  });

  it("applyBlockTexts 批量替换多段文本，保留 blockId", async () => {
    const { doc, ref } = setup(["共同的表明", "second para", "third"]);
    const [b1, b2, b3] = doc.blocks.map((x) => x.id);

    const ok = ref.current!.applyBlockTexts(
      new Map([
        [b1, "共同表明"],
        [b2, "2nd para"],
      ]),
    );
    expect(ok).toBe(true);

    await waitFor(() => {
      const json = currentJSON(ref);
      const blocks = tiptapToBlocks(json);
      expect(blocks[0].text).toBe("共同表明");
      expect(blocks[1].text).toBe("2nd para");
      expect(blocks[2].text).toBe("third");
      // blockId 保留
      expect(blocks[0].blockId).toBe(b1);
      expect(blocks[1].blockId).toBe(b2);
      expect(blocks[2].blockId).toBe(b3);
    });
  });

  it("revertBlockTexts 逐字还原（撤销批量修改）", async () => {
    const original = ["hello world", "foo bar"];
    const { doc, ref } = setup(original);
    const [b1, b2] = doc.blocks.map((x) => x.id);

    // 应用
    ref.current!.applyBlockTexts(
      new Map([
        [b1, "hello there"],
        [b2, "baz qux"],
      ]),
    );
    await waitFor(() => {
      expect(tiptapToBlocks(currentJSON(ref))[0].text).toBe("hello there");
    });

    // 撤销
    const ok = ref.current!.revertBlockTexts(
      new Map([
        [b1, original[0]],
        [b2, original[1]],
      ]),
    );
    expect(ok).toBe(true);
    await waitFor(() => {
      const blocks = tiptapToBlocks(currentJSON(ref));
      expect(blocks[0].text).toBe(original[0]);
      expect(blocks[1].text).toBe(original[1]);
      expect(blocks[0].blockId).toBe(b1);
    });
  });

  it("对不存在的 block 应用返回 false，不破坏现有内容", async () => {
    const { ref } = setup(["keep me"]);
    const ok = ref.current!.applyBlockTexts(new Map([["p_不存在", "x"]]));
    expect(ok).toBe(false);
    await waitFor(() => {
      expect(tiptapToBlocks(currentJSON(ref))[0].text).toBe("keep me");
    });
  });

  it("批量应用触发 onDocumentChange 推进 revision（供上层标记过期建议）", async () => {
    const { doc, ref, getLatest } = setup(["aaa", "bbb"]);
    const b1 = doc.blocks[0].id;
    ref.current!.applyBlockTexts(new Map([[b1, "ccc"]]));
    await waitFor(() => {
      expect(getLatest().revision).toBeGreaterThan(doc.revision);
      expect(getLatest().blocks[0].text).toBe("ccc");
    });
  });
});

// 从 DOM 读取当前编辑器 JSON（经由 ProseMirror 视图）
function currentJSON(ref: { current: DocumentEditorHandle | null }): PMDocNode {
  // DocumentEditor 未直接暴露 editor 实例；通过 revealItem 不可行。
  // 这里借助 DOM：Tiptap 把内容渲染进 .ProseMirror。
  void ref;
  const el = document.querySelector(".ProseMirror");
  if (!el) throw new Error("editor not mounted");
  // 从 DOM 重建段落文本与 blockId（与 tiptapToBlocks 结构一致）
  const paras = Array.from(el.querySelectorAll("p")).map((p) => ({
    type: "paragraph" as const,
    attrs: { blockId: p.getAttribute("data-block-id") },
    content: p.textContent ? [{ type: "text" as const, text: p.textContent }] : undefined,
  }));
  return { type: "doc", content: paras };
}
