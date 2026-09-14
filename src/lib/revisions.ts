import type { DocumentBlock, DocumentState } from "./review-schema";

/**
 * 文档版本与稳定段落 ID（PLAN 第 10 节）。
 *
 * 稳定 block ID 的规则：
 * - 每个段落创建时获得 UUID；
 * - 普通文字编辑不改变 block ID；
 * - 拆分段落时保留前半段 ID，后半段创建新 ID；
 * - 合并段落时保留目标段落 ID，被并入段落的 ID 消失（引用它的建议应过期）。
 */

export function newBlockId(): string {
  return `p_${crypto.randomUUID()}`;
}

export function newDocumentId(): string {
  return `doc_${crypto.randomUUID()}`;
}

export function createBlock(text: string, id?: string): DocumentBlock {
  return { id: id ?? newBlockId(), type: "paragraph", text };
}

/** 内容校验和：由所有段落文本及其 ID 派生，用于快速判断正文是否变化 */
export function computeChecksum(blocks: DocumentBlock[]): string {
  const payload = blocks.map((b) => `${b.id}:${b.text}`).join("\n");
  return fnv1a(payload);
}

/** FNV-1a 32 位哈希，输出十六进制。轻量、确定性，足够做变更检测 */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createDocument(
  title: string,
  texts: string[] = [""],
): DocumentState {
  const blocks = texts.map((t) => createBlock(t));
  return {
    id: newDocumentId(),
    title,
    blocks,
    revision: 0,
    checksum: computeChecksum(blocks),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 基于新段落内容推进文档状态。
 * 所有编辑操作最终都通过它统一递增 revision、更新 checksum 和 updatedAt。
 */
function nextState(doc: DocumentState, blocks: DocumentBlock[]): DocumentState {
  return {
    ...doc,
    blocks,
    revision: doc.revision + 1,
    checksum: computeChecksum(blocks),
    updatedAt: new Date().toISOString(),
  };
}

export function findBlockIndex(
  doc: DocumentState,
  blockId: string,
): number {
  return doc.blocks.findIndex((b) => b.id === blockId);
}

/** 更新某段文字，保留其 block ID（普通编辑不改变 ID） */
export function updateBlockText(
  doc: DocumentState,
  blockId: string,
  text: string,
): DocumentState {
  const idx = findBlockIndex(doc, blockId);
  if (idx < 0) return doc;
  const blocks = doc.blocks.slice();
  blocks[idx] = { ...blocks[idx], text };
  return nextState(doc, blocks);
}

/**
 * 把一段拆成两段：前半段保留原 ID，后半段分配新 ID。
 * offset 为段内字符偏移。
 */
export function splitBlock(
  doc: DocumentState,
  blockId: string,
  offset: number,
): DocumentState {
  const idx = findBlockIndex(doc, blockId);
  if (idx < 0) return doc;
  const block = doc.blocks[idx];
  const clamped = Math.max(0, Math.min(offset, block.text.length));
  const first: DocumentBlock = { ...block, text: block.text.slice(0, clamped) };
  const second: DocumentBlock = createBlock(block.text.slice(clamped));
  const blocks = [
    ...doc.blocks.slice(0, idx),
    first,
    second,
    ...doc.blocks.slice(idx + 1),
  ];
  return nextState(doc, blocks);
}

/**
 * 把 sourceId 段合并到 targetId 段末尾：保留 targetId，
 * sourceId 消失（引用 sourceId 的建议之后应标记过期）。
 */
export function mergeBlocks(
  doc: DocumentState,
  targetId: string,
  sourceId: string,
): DocumentState {
  const targetIdx = findBlockIndex(doc, targetId);
  const sourceIdx = findBlockIndex(doc, sourceId);
  if (targetIdx < 0 || sourceIdx < 0 || targetIdx === sourceIdx) return doc;
  const target = doc.blocks[targetIdx];
  const source = doc.blocks[sourceIdx];
  const merged: DocumentBlock = {
    ...target,
    text: target.text + source.text,
  };
  const blocks = doc.blocks
    .filter((b) => b.id !== sourceId && b.id !== targetId);
  const insertAt = Math.min(targetIdx, sourceIdx);
  blocks.splice(insertAt, 0, merged);
  return nextState(doc, blocks);
}

export function removeBlock(
  doc: DocumentState,
  blockId: string,
): DocumentState {
  const idx = findBlockIndex(doc, blockId);
  if (idx < 0) return doc;
  const blocks = doc.blocks.filter((b) => b.id !== blockId);
  return nextState(doc, blocks);
}

export function insertBlockAfter(
  doc: DocumentState,
  afterBlockId: string | null,
  text: string,
): DocumentState {
  const block = createBlock(text);
  if (afterBlockId === null) {
    return nextState(doc, [block, ...doc.blocks]);
  }
  const idx = findBlockIndex(doc, afterBlockId);
  if (idx < 0) return doc;
  const blocks = [
    ...doc.blocks.slice(0, idx + 1),
    block,
    ...doc.blocks.slice(idx + 1),
  ];
  return nextState(doc, blocks);
}

/** 用一组新段落整体替换文档内容（例如粘贴全文），全部获得新 ID */
export function replaceAllBlocks(
  doc: DocumentState,
  texts: string[],
): DocumentState {
  return nextState(doc, texts.map((t) => createBlock(t)));
}

/** 判断响应回来时正文是否仍与请求时一致（PLAN 10.5） */
export function isRevisionCompatible(
  doc: DocumentState,
  revision: number,
  checksum: string,
): boolean {
  return doc.revision === revision && doc.checksum === checksum;
}
