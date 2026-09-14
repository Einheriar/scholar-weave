import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { BlockIdExtension } from "@/components/editor/BlockIdExtension";
import {
  ReviewDecorationExtension,
  type ReviewDecorationConfig,
} from "@/components/editor/ReviewDecorationExtension";
import { docToTiptap } from "@/lib/tiptap-convert";
import { buildSampleDocument, buildSampleReview } from "@/lib/sample-data";
import { reviewDecorationKey } from "@/components/editor/ReviewDecorationExtension";
import type { ReviewItem } from "@/lib/review-schema";

function makeEditor(
  doc: ReturnType<typeof buildSampleDocument>["doc"],
  getConfig: () => ReviewDecorationConfig,
): Editor {
  return new Editor({
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
      ReviewDecorationExtension.configure({ getConfig }),
    ],
    content: docToTiptap(doc),
  });
}

function decoAttrs(editor: Editor) {
  const set = reviewDecorationKey.getState(editor.state);
  const found: Array<{ id: string; cls: string }> = [];
  if (!set) return found;
  set.find().forEach((d) => {
    const deco = d as unknown as {
      spec?: { reviewId?: string };
      type?: { attrs?: { class?: string; "data-review-id"?: string } };
    };
    found.push({
      id: deco.type?.attrs?.["data-review-id"] ?? deco.spec?.reviewId ?? "",
      cls: deco.type?.attrs?.class ?? "",
    });
  });
  return found;
}

describe("ReviewDecorationExtension（阶段 2）", () => {
  it("为 open 的 range 建议渲染 inline 下划线，为 block 建议渲染 node 标记", () => {
    const { doc } = buildSampleDocument();
    const items = buildSampleReview(doc);
    const cfg: ReviewDecorationConfig = { items, selectedId: null };
    const editor = makeEditor(doc, () => cfg);

    const decos = decoAttrs(editor);
    const ids = decos.map((d) => d.id);
    // 5 条 open 的 range edit 都应有下划线
    expect(ids.filter(Boolean).length).toBeGreaterThanOrEqual(7);
    expect(ids).toContain("review_edit_1");
    // stale 建议不画
    expect(ids).not.toContain("review_edit_stale");
    editor.destroy();
  });

  it("选中态：设置 selectedId 并刷新后，对应 Decoration 带 rev-selected", () => {
    const { doc } = buildSampleDocument();
    const items = buildSampleReview(doc);
    let cfg: ReviewDecorationConfig = { items, selectedId: null };
    const editor = makeEditor(doc, () => cfg);

    // 初始无选中
    expect(decoAttrs(editor).some((d) => d.cls.includes("rev-selected"))).toBe(
      false,
    );

    // 模拟 DocumentEditor：更新 cfg 并派发带 PluginKey meta 的事务触发重建
    cfg = { items, selectedId: "review_edit_1" };
    editor.view.dispatch(
      editor.state.tr.setMeta(reviewDecorationKey, true),
    );

    const sel = decoAttrs(editor).filter(
      (d) => d.id === "review_edit_1" && d.cls.includes("rev-selected"),
    );
    expect(sel.length).toBe(1);
    editor.destroy();
  });

  it("点击路径：range 标记的 Decoration 携带 data-review-id（正文→侧栏定位由 E2E 覆盖）", () => {
    const { doc } = buildSampleDocument();
    const items = buildSampleReview(doc);
    const editor = makeEditor(doc, () => ({ items, selectedId: null }));

    const set = reviewDecorationKey.getState(editor.state);
    const target = set?.find().find((d) => {
      const deco = d as unknown as {
        type?: { attrs?: { "data-review-id"?: string } };
      };
      return deco.type?.attrs?.["data-review-id"] === "review_edit_1";
    });
    expect(target).toBeTruthy();
    editor.destroy();
  });

  it("过期(stale)建议不渲染任何 Decoration", () => {
    const { doc } = buildSampleDocument();
    const items: ReviewItem[] = buildSampleReview(doc).map((i) => ({
      ...i,
      status: "stale" as const,
    }));
    const editor = makeEditor(doc, () => ({ items, selectedId: null }));
    expect(decoAttrs(editor).length).toBe(0);
    editor.destroy();
  });
});
