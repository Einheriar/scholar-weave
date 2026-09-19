import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { ReviewItem } from "@/lib/review-schema";
import { locateInText } from "@/lib/anchoring";
import { pmPlainText } from "@/lib/tiptap-convert";

/**
 * 把 ReviewItem 渲染为编辑器里的视觉标记（PLAN 10.4 / 6.2）。
 *
 * - range 建议：对命中文本加 Decoration.inline 下划线，颜色/线型随 category；
 * - block 建议：对整个段落加 Decoration.node，左侧竖线/编号徽标；
 * - document 建议：不在正文画标记，只出现在侧栏“全文审阅”区。
 *
 * 关键约束：Decoration 只存在于视图层，绝不序列化进正文。
 * 用户编辑时由 ProseMirror 自动 map Decoration 位置；
 * 与建议范围相交的编辑由上层把该建议标记为 stale。
 */

export type ReviewDecorationConfig = {
  /** 当前要显示的建议（上层负责先按文档 revision/定位校验过滤） */
  items: ReviewItem[];
  /** 当前选中的建议 id，用于高亮 */
  selectedId?: string | null;
  /** 点击某个 range 标记时回调（用于正文→侧栏定位） */
  onSelect?: (id: string) => void;
};

const reviewDecoKey = new PluginKey<DecorationSet>("reviewDecorations");

/** 导出以便测试/调试读取 Decoration 状态 */
export const reviewDecorationKey = reviewDecoKey;

const CATEGORY_CLASS: Record<string, string> = {
  grammar: "rev-underline rev-grammar",
  clarity: "rev-underline rev-clarity",
  style: "rev-underline rev-style",
  structure: "rev-underline rev-structure",
  logic: "rev-underline rev-logic",
  consistency: "rev-underline rev-consistency",
};

function buildDecorations(
  doc: Parameters<typeof DecorationSet.create>[0],
  config: ReviewDecorationConfig,
): DecorationSet {
  const decos: Decoration[] = [];

  // 收集 blockId → 文档中该 paragraph 的起始位置
  const blockStarts = new Map<string, number>();
  doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph") return false;
    const id = node.attrs.blockId as string | null;
    if (id) blockStarts.set(id, pos);
    return false;
  });

  for (const item of config.items) {
    if (item.status !== "open") continue; // Only actionable reviews keep body markers.

    if (item.scope.type === "range") {
      const blockStart = blockStarts.get(item.scope.blockId);
      if (blockStart === undefined) continue;
      // 块内偏移 → PM 位置：paragraph 内容从 blockStart+1 开始
      const node = doc.nodeAt(blockStart);
      if (!node) continue;
      const text = pmPlainText(node);
      const hit = locateInText(
        text,
        item.scope.original,
        item.scope.prefix,
        item.scope.suffix,
      );
      if (!hit.ok) continue; // 定位失败，跳过（上层会把它标记为 stale）
      const from = blockStart + 1 + hit.start;
      const to = blockStart + 1 + hit.end;
      const cls =
        CATEGORY_CLASS[item.category] ?? "rev-underline rev-clarity";
      const selected = config.selectedId === item.id ? " rev-selected" : "";
      decos.push(
        Decoration.inline(
          from,
          to,
          {
            class: cls + selected,
            "data-review-id": item.id,
            "data-review-kind": item.kind,
            "data-review-category": item.category,
            role: "mark",
            "aria-label": `${item.category} 建议：${item.title}`,
          },
          { reviewId: item.id },
        ),
      );
    } else if (item.scope.type === "block") {
      const blockStart = blockStarts.get(item.scope.blockId);
      if (blockStart === undefined) continue;
      const node = doc.nodeAt(blockStart);
      if (!node) continue;
      const selected = config.selectedId === item.id ? " rev-selected" : "";
      decos.push(
        Decoration.node(
          blockStart,
          blockStart + node.nodeSize,
          {
            class: `rev-block-marker${selected}`,
            "data-review-id": item.id,
            "data-block-category": item.category,
          },
          { reviewId: item.id },
        ),
      );
    }
    // document 级不画正文标记
  }

  return DecorationSet.create(doc, decos);
}

export const ReviewDecorationExtension =
  Extension.create<{ getConfig: () => ReviewDecorationConfig }>({
    name: "reviewDecorations",

    addOptions() {
      return {
        getConfig: (): ReviewDecorationConfig => ({ items: [] }),
      };
    },

    addProseMirrorPlugins() {
      const getConfig = () => this.options.getConfig();

      return [
        new Plugin<DecorationSet>({
          key: reviewDecoKey,
          state: {
            init: (_config, { doc }) => buildDecorations(doc, getConfig()),
            apply: (tr, old) => {
              // 先让旧 Decoration 随事务自动映射位置
              const mapped = old.map(tr.mapping, tr.doc);
              // 文档或配置变化时重建，确保与最新 items 一致
              if (tr.docChanged || tr.getMeta(reviewDecoKey)) {
                return buildDecorations(tr.doc, getConfig());
              }
              return mapped;
            },
          },
          props: {
            decorations(state) {
              return reviewDecoKey.getState(state);
            },
            handleClick(_view, _pos, event) {
              const target = event.target as HTMLElement | null;
              const el = target?.closest?.("[data-review-id]");
              const id = el?.getAttribute("data-review-id");
              if (id) {
                getConfig().onSelect?.(id);
                return true;
              }
              return false;
            },
          },
        }),
      ];
    },
  });

/** 触发 Decoration 重建（items 或 selectedId 变化时调用） */
export function refreshReviewDecorations(
  editor: { view: { dispatch: (tr: never) => void; state: { tr: unknown } } } | null,
): void {
  if (!editor) return;
  const tr = editor.view.state.tr as { setMeta: (k: unknown, v: unknown) => unknown };
  editor.view.dispatch(tr.setMeta(reviewDecoKey, true) as never);
}
