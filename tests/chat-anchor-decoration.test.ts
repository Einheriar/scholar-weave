import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { BlockIdExtension } from "@/components/editor/BlockIdExtension";
import {
  ChatAnchorDecorationExtension,
  chatAnchorDecorationKey,
  type ChatAnchorDecorationConfig,
} from "@/components/editor/ChatAnchorDecorationExtension";
import { docToTiptap } from "@/lib/tiptap-convert";
import { buildSampleDocument } from "@/lib/sample-data";
import type { ChatNode } from "@/lib/review-schema";

function makeEditor(
  doc: ReturnType<typeof buildSampleDocument>["doc"],
  getConfig: () => ChatAnchorDecorationConfig,
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
      ChatAnchorDecorationExtension.configure({ getConfig }),
    ],
    content: docToTiptap(doc),
  });
}

function decoAttrs(editor: Editor) {
  const set = chatAnchorDecorationKey.getState(editor.state);
  const found: Array<{ id: string; cls: string }> = [];
  if (!set) return found;
  set.find().forEach((d) => {
    const deco = d as unknown as {
      spec?: { chatNodeId?: string };
      type?: { attrs?: { class?: string; "data-chat-anchor-id"?: string } };
    };
    found.push({
      id: deco.type?.attrs?.["data-chat-anchor-id"] ?? deco.spec?.chatNodeId ?? "",
      cls: deco.type?.attrs?.class ?? "",
    });
  });
  return found;
}

function rangeNode(id: string, blockId: string, selectedText: string): ChatNode {
  return {
    id,
    anchor: { type: "range", blockId, selectedText },
    originalText: selectedText,
    createdAt: "2026-09-15T10:00:00.000Z",
    turns: [{ role: "user", content: "问" }],
  };
}

describe("ChatAnchorDecorationExtension（阶段 6）", () => {
  it("为可定位的 range 锚点渲染 chat-anchor inline 标记", () => {
    const { doc, blockIds } = buildSampleDocument();
    // PARAGRAPHS[2] 含 "upstanding"
    const node = rangeNode("n1", blockIds[2], "upstanding");
    const cfg: ChatAnchorDecorationConfig = { nodes: [node], document: doc };
    const editor = makeEditor(doc, () => cfg);

    const decos = decoAttrs(editor);
    expect(decos.map((d) => d.id)).toContain("n1");
    expect(decos[0].cls).toContain("chat-anchor");
    editor.destroy();
  });

  it("锚点失效（原文被改/删）时不画标记（规则 12）", () => {
    const { doc, blockIds } = buildSampleDocument();
    // 原文不存在于文档中
    const node = rangeNode("n1", blockIds[2], "nonexistent-xyz");
    const editor = makeEditor(doc, () => ({ nodes: [node], document: doc }));
    expect(decoAttrs(editor).length).toBe(0);
    editor.destroy();
  });

  it("block 锚点渲染 chat-anchor-block node 标记", () => {
    const { doc, blockIds } = buildSampleDocument();
    const node: ChatNode = {
      id: "nb",
      anchor: { type: "block", blockId: blockIds[1] },
      originalText: "",
      createdAt: "2026-09-15T10:00:00.000Z",
      turns: [],
    };
    const editor = makeEditor(doc, () => ({ nodes: [node], document: doc }));
    const decos = decoAttrs(editor);
    expect(decos.map((d) => d.id)).toContain("nb");
    expect(decos[0].cls).toContain("chat-anchor-block");
    editor.destroy();
  });

  it("document / review 锚点不画正文标记", () => {
    const { doc } = buildSampleDocument();
    const nodes: ChatNode[] = [
      {
        id: "nd",
        anchor: { type: "document" },
        originalText: "",
        createdAt: "2026-09-15T10:00:00.000Z",
        turns: [],
      },
      {
        id: "nr",
        anchor: { type: "review", reviewId: "rev_1" },
        originalText: "",
        createdAt: "2026-09-15T10:00:00.000Z",
        turns: [],
      },
    ];
    const editor = makeEditor(doc, () => ({ nodes, document: doc }));
    expect(decoAttrs(editor).length).toBe(0);
    editor.destroy();
  });

  it("Decoration 只存在于视图层：编辑后正文序列化不含 data-chat-anchor-id", () => {
    const { doc, blockIds } = buildSampleDocument();
    const node = rangeNode("n1", blockIds[2], "upstanding");
    const editor = makeEditor(doc, () => ({ nodes: [node], document: doc }));

    // 序列化后的 HTML 不应含锚点属性（Decoration 不进正文）
    const html = editor.getHTML();
    expect(html).not.toContain("data-chat-anchor-id");
    expect(html).not.toContain("chat-anchor");
    editor.destroy();
  });
});
