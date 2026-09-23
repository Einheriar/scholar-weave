import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { ChatNode, DocumentState } from "@/lib/review-schema";
import { canLocateScope } from "@/lib/anchoring";
import { locateChatNodeRange } from "@/lib/chat-range-anchor";

/**
 * 把聊天节点锚点渲染为编辑器里的视觉标记（锚点节点方案 / 正文锚点标记）。
 *
 * - range 锚点（选区文字）：对命中文本加 Decoration.inline 的 2px 点状下划线；
 * - block 锚点（段落）：对段落起始加 Decoration.node 的左侧圆点竖条；
 * - document / review 锚点：不在正文画标记（review 由审阅标记体系呈现）。
 *
 * 关键约束同 ReviewDecorationExtension：Decoration 只存在于视图层，绝不序列化进正文。
 * 锚点失效（原文被改/删）时不画标记（规则 12：正文内锚点标记消失，对话仍可读）。
 */

export type ChatAnchorDecorationConfig = {
  /** 当前项目的聊天节点 */
  nodes: ChatNode[];
  /** 当前文档（用于 canLocateScope 判定锚点是否失效） */
  document: DocumentState | null;
  /** 点击某个锚点标记时回调（正文→聊天区对应节点） */
  onSelect?: (nodeId: string) => void;
};

const chatAnchorDecoKey = new PluginKey<DecorationSet>("chatAnchorDecorations");

/** 导出以便测试/调试读取 Decoration 状态 */
export const chatAnchorDecorationKey = chatAnchorDecoKey;

function buildDecorations(
  doc: Parameters<typeof DecorationSet.create>[0],
  config: ChatAnchorDecorationConfig,
): DecorationSet {
  const decos: Decoration[] = [];
  const { nodes, document } = config;
  if (!document) return DecorationSet.create(doc, decos);

  const blockStarts = new Map<string, number>();
  doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph") return false;
    const id = node.attrs.blockId as string | null;
    if (id) blockStarts.set(id, pos);
    return false;
  });

  for (const node of nodes) {
    const a = node.anchor;

    if (a.type === "range") {
      const hit = locateChatNodeRange(document, node);
      if (!hit.ok) continue;
      const segments = hit.segments?.length
        ? hit.segments
        : [{ blockId: hit.blockId, start: hit.start, end: hit.end }];
      for (const segment of segments) {
        const blockStart = blockStarts.get(segment.blockId);
        if (blockStart === undefined) continue;
        const pmNode = doc.nodeAt(blockStart);
        if (!pmNode) continue;
        const from = blockStart + 1 + segment.start;
        const to = blockStart + 1 + segment.end;
        if (to <= from) continue;
        decos.push(
          Decoration.inline(
            from,
            to,
            {
              class: "chat-anchor",
              "data-chat-anchor-id": node.id,
              role: "mark",
              "aria-label": `聊天节点：${node.originalText || a.selectedText || "讨论"}`,
            },
            { chatNodeId: node.id },
          ),
        );
      }
    } else if (a.type === "block") {
      if (!a.blockId || !canLocateScope(document, { type: "block", blockId: a.blockId })) {
        continue;
      }
      const blockStart = blockStarts.get(a.blockId);
      if (blockStart === undefined) continue;
      const pmNode = doc.nodeAt(blockStart);
      if (!pmNode) continue;
      decos.push(
        Decoration.node(
          blockStart,
          blockStart + pmNode.nodeSize,
          {
            class: "chat-anchor-block",
            "data-chat-anchor-id": node.id,
          },
          { chatNodeId: node.id },
        ),
      );
    }
    // document / review 锚点不画正文标记
  }

  return DecorationSet.create(doc, decos);
}

export const ChatAnchorDecorationExtension =
  Extension.create<{ getConfig: () => ChatAnchorDecorationConfig }>({
    name: "chatAnchorDecorations",

    addOptions() {
      return {
        getConfig: (): ChatAnchorDecorationConfig => ({ nodes: [], document: null }),
      };
    },

    addProseMirrorPlugins() {
      const getConfig = () => this.options.getConfig();

      return [
        new Plugin<DecorationSet>({
          key: chatAnchorDecoKey,
          state: {
            init: (_config, { doc }) => buildDecorations(doc, getConfig()),
            apply: (tr, old) => {
              const mapped = old.map(tr.mapping, tr.doc);
              if (tr.docChanged || tr.getMeta(chatAnchorDecoKey)) {
                return buildDecorations(tr.doc, getConfig());
              }
              return mapped;
            },
          },
          props: {
            decorations(state) {
              return chatAnchorDecoKey.getState(state);
            },
            handleClick(_view, _pos, event) {
              const target = event.target as HTMLElement | null;
              const el = target?.closest?.("[data-chat-anchor-id]");
              const id = el?.getAttribute("data-chat-anchor-id");
              if (id) {
                getConfig().onSelect?.(id);
                // 返回 false 把点击继续传给后面的插件：这段文字可能同时是某条
                // 审阅建议的范围（review 标记 + 聊天锚点重叠），return true 会把
                // 点击吃掉，导致 ReviewDecorationExtension 收不到、右侧卡片不跳。
                return false;
              }
              return false;
            },
          },
        }),
      ];
    },
  });
