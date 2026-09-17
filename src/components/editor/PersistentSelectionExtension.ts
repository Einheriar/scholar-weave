import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Keeps a visual copy of the current text selection in the document tree.
 *
 * Browsers can paint only one native selection at a time. Once focus moves
 * from ProseMirror to the chat textarea, the editor selection still exists in
 * ProseMirror state but its native highlight is no longer visible. This
 * decoration mirrors the exact state range; CSS reveals it only while the
 * editor is blurred and the range represents a user/chat selection.
 */
export const PersistentSelectionExtension = Extension.create({
  name: "persistentSelection",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const selection = state.selection;
            if (!(selection instanceof TextSelection) || selection.empty) {
              return DecorationSet.empty;
            }

            return DecorationSet.create(state.doc, [
              Decoration.inline(selection.from, selection.to, {
                class: "manual-selection-persisted",
                "data-manual-selection-highlight": "true",
              }),
            ]);
          },
        },
      }),
    ];
  },
});
