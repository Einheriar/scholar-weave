import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { newBlockId } from "@/lib/revisions";

/**
 * 给每个 paragraph 节点附加稳定的 `blockId` 属性（PLAN 10.2）。
 *
 * - 创建（包括从纯文本初始化、粘贴新段）时分配 UUID；
 * - 普通文字编辑只改 text，不改属性，ID 保持稳定；
 * - 拆分（回车）：ProseMirror 默认会让后半段继承 attrs。这里在
 *   appendTransaction 里检测"同 id 的相邻段落"，为后一段换新 ID——
 *   即前半段保留原 ID，后半段是新段落；
 * - 合并：ProseMirror 删除段边界后只保留目标段节点，其 attrs（含 ID）
 *   天然保留，被并入段的 ID 随之消失。
 */

const blockIdPluginKey = new PluginKey("blockId");

export const BlockIdExtension = Extension.create({
  name: "blockId",

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          blockId: {
            default: null,
            parseHTML: (el) => el.getAttribute("data-block-id"),
            renderHTML: (attrs) =>
              attrs.blockId ? { "data-block-id": attrs.blockId } : {},
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: blockIdPluginKey,
        appendTransaction(
          _transactions: readonly Transaction[],
          _oldState: EditorState,
          newState: EditorState,
        ): Transaction | null {
          const seen = new Set<string>();
          const tr = newState.tr;
          let modified = false;

          newState.doc.descendants((node, pos) => {
            if (node.type.name !== "paragraph") return true;

            let id = node.attrs.blockId as string | null;
            // 新段（无 ID）或拆分产生的重复 ID（与已见 ID 冲突的后段）需要新 ID
            if (id === null || seen.has(id)) {
              id = newBlockId();
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: id });
              modified = true;
            }
            seen.add(id);
            return false; // paragraph 无嵌套，不必深入
          });

          return modified ? tr : null;
        },
      }),
    ];
  },
});
