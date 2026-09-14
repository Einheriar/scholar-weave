import type { DocumentState, ReviewScope } from "./review-schema";
import { findBlockIndex } from "./revisions";

/**
 * 文本锚点定位（PLAN 第 10 节）。
 *
 * 不信任 LLM 返回的字符坐标。改为：在指定 block 中用逐字匹配的
 * `original` 定位，并用可选的 `prefix` / `suffix` 上下文消歧。
 * 无法可靠定位时返回失败原因，由调用方把建议标记为 stale——
 * 绝不猜测位置后强行替换。
 */

export type LocatedRange = {
  blockId: string;
  /** original 在 block.text 中的起始字符偏移（含） */
  start: number;
  /** original 在 block.text 中的结束字符偏移（不含） */
  end: number;
};

export type AnchorFailure =
  | { ok: false; reason: "block_not_found"; blockId: string }
  | { ok: false; reason: "original_not_found"; blockId: string; original: string }
  | { ok: false; reason: "ambiguous"; blockId: string; original: string; occurrences: number }
  | { ok: false; reason: "context_mismatch"; blockId: string; original: string };

export type AnchorResult =
  | ({ ok: true } & LocatedRange)
  | AnchorFailure;

/** 统计 needle 在 haystack 中出现的所有起始偏移 */
function findOccurrences(haystack: string, needle: string): number[] {
  const offsets: number[] = [];
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) break;
    offsets.push(idx);
    from = idx + 1; // 允许重叠出现
  }
  return offsets;
}

/** 校验某个出现位置是否与可选的 prefix/suffix 上下文吻合 */
function contextMatches(
  text: string,
  start: number,
  end: number,
  prefix?: string,
  suffix?: string,
): boolean {
  if (prefix !== undefined) {
    const before = text.slice(Math.max(0, start - prefix.length), start);
    if (before !== prefix) return false;
  }
  if (suffix !== undefined) {
    const after = text.slice(end, end + suffix.length);
    if (after !== suffix) return false;
  }
  return true;
}

/**
 * 在文档中定位一个 range scope。
 * 定位流程（PLAN 10.3）：
 *   block 存在 → original 能在该 block 中逐字找到 →
 *   若多次出现则用 prefix/suffix 消歧 → 必须唯一命中。
 */
export function locateRange(
  doc: DocumentState,
  scope: Extract<ReviewScope, { type: "range" }>,
): AnchorResult {
  const idx = findBlockIndex(doc, scope.blockId);
  if (idx < 0) {
    return { ok: false, reason: "block_not_found", blockId: scope.blockId };
  }
  const text = doc.blocks[idx].text;

  const occurrences = findOccurrences(text, scope.original);
  if (occurrences.length === 0) {
    return {
      ok: false,
      reason: "original_not_found",
      blockId: scope.blockId,
      original: scope.original,
    };
  }

  let start: number;
  if (occurrences.length === 1) {
    start = occurrences[0];
    const end = start + scope.original.length;
    // 仅出现一次时，若提供了上下文却不吻合，说明文本已变化
    if (!contextMatches(text, start, end, scope.prefix, scope.suffix)) {
      return {
        ok: false,
        reason: "context_mismatch",
        blockId: scope.blockId,
        original: scope.original,
      };
    }
    return { ok: true, blockId: scope.blockId, start, end };
  }

  // 多次出现：用 prefix/suffix 消歧
  const matched = occurrences.filter((s) =>
    contextMatches(text, s, s + scope.original.length, scope.prefix, scope.suffix),
  );
  if (matched.length === 1) {
    const s = matched[0];
    return {
      ok: true,
      blockId: scope.blockId,
      start: s,
      end: s + scope.original.length,
    };
  }
  if (matched.length === 0) {
    return {
      ok: false,
      reason: "context_mismatch",
      blockId: scope.blockId,
      original: scope.original,
    };
  }
  return {
    ok: false,
    reason: "ambiguous",
    blockId: scope.blockId,
    original: scope.original,
    occurrences: matched.length,
  };
}

/**
 * 校验一条建议的 scope 是否仍然可以可靠定位。
 * document / block 级只检查目标是否存在；range 级做完整定位。
 */
export function canLocateScope(
  doc: DocumentState,
  scope: ReviewScope,
): boolean {
  switch (scope.type) {
    case "document":
      return true;
    case "block":
      return findBlockIndex(doc, scope.blockId) >= 0;
    case "range":
      return locateRange(doc, scope).ok;
  }
}

/**
 * 在 block 内把 [start, end) 范围替换为 replacement，返回新文本。
 * 不做定位校验——调用方应先用 locateRange 确认。
 */
export function applyReplacement(
  text: string,
  start: number,
  end: number,
  replacement: string,
): string {
  return text.slice(0, start) + replacement + text.slice(end);
}
