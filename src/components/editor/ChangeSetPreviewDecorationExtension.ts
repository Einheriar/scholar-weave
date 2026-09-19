import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { ConcreteEdit } from "@/lib/review-schema";
import { locateInText } from "@/lib/anchoring";
import { pmPlainText } from "@/lib/tiptap-convert";

export type ChangeSetPreviewDecorationConfig = {
  edit: ConcreteEdit | null;
};

const changeSetPreviewDecoKey = new PluginKey<DecorationSet>(
  "changeSetPreviewDecorations",
);

export const changeSetPreviewDecorationKey = changeSetPreviewDecoKey;

function buildDecorations(
  doc: Parameters<typeof DecorationSet.create>[0],
  config: ChangeSetPreviewDecorationConfig,
): DecorationSet {
  const edit = config.edit;
  if (!edit) return DecorationSet.empty;

  let blockStart: number | null = null;
  doc.descendants((node, pos) => {
    if (
      blockStart === null &&
      node.type.name === "paragraph" &&
      node.attrs.blockId === edit.blockId
    ) {
      blockStart = pos;
    }
    return blockStart === null;
  });
  if (blockStart === null) return DecorationSet.empty;

  const block = doc.nodeAt(blockStart);
  if (!block) return DecorationSet.empty;
  const hit = locateInText(
    pmPlainText(block),
    edit.original,
    edit.prefix,
    edit.suffix,
  );
  if (!hit.ok) return DecorationSet.empty;

  return DecorationSet.create(doc, [
    Decoration.inline(
      blockStart + 1 + hit.start,
      blockStart + 1 + hit.end,
      {
        class: "changeset-preview-highlight",
        "data-changeset-preview-edit-id": edit.id,
        role: "mark",
        "aria-label": "修改集预览对应原文",
      },
      { editId: edit.id },
    ),
  ]);
}

export const ChangeSetPreviewDecorationExtension = Extension.create<{
  getConfig: () => ChangeSetPreviewDecorationConfig;
}>({
  name: "changeSetPreviewDecorations",

  addOptions() {
    return {
      getConfig: (): ChangeSetPreviewDecorationConfig => ({ edit: null }),
    };
  },

  addProseMirrorPlugins() {
    const getConfig = () => this.options.getConfig();
    return [
      new Plugin<DecorationSet>({
        key: changeSetPreviewDecoKey,
        state: {
          init: (_config, { doc }) => buildDecorations(doc, getConfig()),
          apply: (tr, old) => {
            const mapped = old.map(tr.mapping, tr.doc);
            if (tr.docChanged || tr.getMeta(changeSetPreviewDecoKey)) {
              return buildDecorations(tr.doc, getConfig());
            }
            return mapped;
          },
        },
        props: {
          decorations(state) {
            return changeSetPreviewDecoKey.getState(state);
          },
        },
      }),
    ];
  },
});
