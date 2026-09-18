import type {
  AcceptedChangeSetSnapshotEntry,
  ChangeSet,
  ConcreteEdit,
  DocumentState,
} from "./review-schema";
import { findBlockIndex } from "./revisions";
import { locateInText } from "./anchoring";

/**
 * 修改集校验与应用（PLAN 3.3 / 10.4 / 阶段 4）。
 *
 * 核心保证：
 * - 应用前逐条定位，定位不到的标记 stale；
 * - 重叠修改不允许盲目同时接受：同 block 内范围相交的只保留一条，其余 stale；
 * - 批量接受在同一段内按位置从后向前替换，避免偏移失效；
 * - 返回撤销所需的快照。
 */

export type ResolvedEdit =
  | { ok: true; edit: ConcreteEdit; start: number; end: number }
  | { ok: false; edit: ConcreteEdit; reason: string };

/** 在文档中定位一条 ConcreteEdit，返回块内 [start,end) 或失败原因 */
export function resolveEdit(
  doc: DocumentState,
  edit: ConcreteEdit,
): ResolvedEdit {
  const idx = findBlockIndex(doc, edit.blockId);
  if (idx < 0) return { ok: false, edit, reason: "block_not_found" };
  const text = doc.blocks[idx].text;
  const hit = locateInText(text, edit.original, edit.prefix, edit.suffix);
  if (!hit.ok) return { ok: false, edit, reason: hit.reason };
  return { ok: true, edit, start: hit.start, end: hit.end };
}

export type PreparedChangeSet = {
  /** 可直接应用的修改（已定位且互不重叠），按 block 分组、块内按 start 升序 */
  applicable: Array<ResolvedEdit & { ok: true }>;
  /** 因定位失败或重叠而不可用的修改 id → 原因 */
  rejected: Map<string, string>;
};

/**
 * 预处理一个 ChangeSet：定位每条修改并剔除重叠项。
 * 同一 block 内范围相交的修改，保留先出现者，后续标 stale。
 */
export function prepareChangeSet(
  doc: DocumentState,
  changeSet: ChangeSet,
): PreparedChangeSet {
  const applicable: Array<ResolvedEdit & { ok: true }> = [];
  const rejected = new Map<string, string>();

  // 先定位
  const resolved = changeSet.edits.map((e) => resolveEdit(doc, e));

  // 按 block 分组做重叠检测
  const byBlock = new Map<string, Array<ResolvedEdit & { ok: true }>>();
  for (const r of resolved) {
    if (!r.ok) {
      rejected.set(r.edit.id, r.reason);
      continue;
    }
    const list = byBlock.get(r.edit.blockId) ?? [];
    list.push(r);
    byBlock.set(r.edit.blockId, list);
  }

  for (const list of byBlock.values()) {
    list.sort((a, b) => a.start - b.start);
    let lastEnd = -1;
    for (const r of list) {
      if (r.start < lastEnd) {
        // 与前一条相交：不允许盲目同时接受
        rejected.set(r.edit.id, "overlap");
        continue;
      }
      lastEnd = r.end;
      applicable.push(r);
    }
  }

  // applicable 保持稳定的整体顺序（按 blockId 再按 start），便于确定性应用
  applicable.sort((a, b) =>
    a.edit.blockId === b.edit.blockId
      ? a.start - b.start
      : a.edit.blockId < b.edit.blockId
        ? -1
        : 1,
  );

  return { applicable, rejected };
}

/** 应用结果：每段的新文本 + 撤销快照 */
export type ApplyResult = {
  /** blockId → 应用后的新文本 */
  newTextByBlock: Map<string, string>;
  /** blockId → 应用前的原文本（撤销用） */
  oldTextByBlock: Map<string, string>;
  appliedIds: string[];
  rejected: Map<string, string>;
};

/** 把一次已计算完成的修改集结果压成可持久化的逐段撤销快照。 */
export function createAcceptedChangeSetSnapshot(
  result: Pick<ApplyResult, "newTextByBlock" | "oldTextByBlock">,
): AcceptedChangeSetSnapshotEntry[] {
  const snapshot: AcceptedChangeSetSnapshotEntry[] = [];
  for (const [blockId, after] of result.newTextByBlock) {
    const before = result.oldTextByBlock.get(blockId);
    if (before === undefined) continue;
    snapshot.push({ blockId, before, after });
  }
  return snapshot;
}

/**
 * 安全准备修改集撤销：所有目标段仍等于接受后的文本才返回恢复映射。
 * 任意一段被继续编辑或丢失都整体拒绝，绝不做部分撤销。
 */
export function prepareAcceptedChangeSetRevert(
  doc: DocumentState,
  snapshot: AcceptedChangeSetSnapshotEntry[],
): Map<string, string> | null {
  if (snapshot.length === 0) return null;
  const oldTextByBlock = new Map<string, string>();
  for (const entry of snapshot) {
    if (oldTextByBlock.has(entry.blockId)) return null;
    const block = doc.blocks.find((candidate) => candidate.id === entry.blockId);
    if (!block || block.text !== entry.after) return null;
    oldTextByBlock.set(entry.blockId, entry.before);
  }
  return oldTextByBlock;
}

/** 判断正文是否已经由其他入口（例如右上角正文撤销）恢复到快照原文。 */
export function isAcceptedChangeSetAlreadyReverted(
  doc: DocumentState,
  snapshot: AcceptedChangeSetSnapshotEntry[],
): boolean {
  return (
    snapshot.length > 0 &&
    snapshot.every((entry) => {
      const block = doc.blocks.find((candidate) => candidate.id === entry.blockId);
      return block?.text === entry.before;
    })
  );
}

/**
 * 计算批量接受的结果（纯函数，不触碰编辑器）。
 * 同一段内按 start 从后向前替换，保证偏移正确（PLAN 10.4）。
 */
export function computeChangeSetApplication(
  doc: DocumentState,
  changeSet: ChangeSet,
): ApplyResult {
  const { applicable, rejected } = prepareChangeSet(doc, changeSet);

  // 按 block 聚合
  const byBlock = new Map<string, Array<ResolvedEdit & { ok: true }>>();
  for (const r of applicable) {
    const list = byBlock.get(r.edit.blockId) ?? [];
    list.push(r);
    byBlock.set(r.edit.blockId, list);
  }

  const newTextByBlock = new Map<string, string>();
  const oldTextByBlock = new Map<string, string>();
  const appliedIds: string[] = [];

  for (const [blockId, list] of byBlock) {
    const idx = findBlockIndex(doc, blockId);
    if (idx < 0) continue;
    const original = doc.blocks[idx].text;
    oldTextByBlock.set(blockId, original);

    // 从后向前替换
    const sorted = [...list].sort((a, b) => b.start - a.start);
    let text = original;
    for (const r of sorted) {
      text = text.slice(0, r.start) + r.edit.replacement + text.slice(r.end);
    }
    newTextByBlock.set(blockId, text);
    for (const r of list) appliedIds.push(r.edit.id);
  }

  return { newTextByBlock, oldTextByBlock, appliedIds, rejected };
}

/** 判断两条修改（在同一段内）是否范围相交 */
export function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}
