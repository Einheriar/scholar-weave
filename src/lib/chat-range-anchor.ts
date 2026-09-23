import { locateInText, locateRange, type AnchorResult, type LocatedRange } from "./anchoring";
import type {
  ChatNode,
  ChatRangeLocator,
  DocumentState,
} from "./review-schema";
import { findBlockIndex } from "./revisions";

const CONTEXT_LENGTH = 64;
const MIN_FUZZY_CONTEXT = 8;

export type ChatAnchorIssue = "changed" | "ambiguous";

type ChatRangeResult = AnchorResult & { segments?: LocatedRange[] };

/** Multi-paragraph selections need all selected blocks available for editing. */
export function selectionNeedsFullDocument(
  doc: DocumentState,
  blockId: string | undefined,
  text: string | undefined,
  locator?: ChatRangeLocator,
): boolean {
  if (!text?.trim()) return false;
  if (locator?.blockIds && locator.blockIds.length > 1) return true;
  const block = doc.blocks.find((entry) => entry.id === blockId);
  return Boolean(block?.text.trim() && block.text.trim() === text.trim());
}

/**
 * Build local-only evidence for a manual editor selection. This metadata is
 * stored on ChatNode, not ChatContext, so it is never included in LLM input.
 */
export function createChatRangeLocator(
  blockText: string,
  start: number,
  end: number,
): ChatRangeLocator | null {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    end > blockText.length
  ) {
    return null;
  }
  return {
    start,
    end,
    prefix: blockText.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: blockText.slice(end, end + CONTEXT_LENGTH),
    blockText,
  };
}

/**
 * Resolve a range chat node without trusting model-produced coordinates.
 *
 * New nodes carry an editor-generated position plus a block snapshot. Exact
 * positions handle duplicate sentences in an unchanged block; stable prefix
 * or suffix regions map the position across edits before/after the selection.
 * Textual evidence is only a fallback, and ambiguous matches are rejected.
 */
export function locateChatNodeRange(
  doc: DocumentState,
  node: ChatNode,
): ChatRangeResult {
  const anchor = node.anchor;
  const blockId = anchor.blockId ?? "";
  const original = anchor.selectedText ?? "";
  if (anchor.type !== "range") {
    return { ok: false, reason: "original_not_found", blockId, original };
  }

  const blockIndex = findBlockIndex(doc, blockId);
  if (blockIndex < 0) {
    return { ok: false, reason: "block_not_found", blockId };
  }
  if (!original) {
    return { ok: false, reason: "original_not_found", blockId, original };
  }

  const locator = node.rangeLocator;
  if (locator?.blockIds) {
    const ids = locator.blockIds;
    const blocks = doc.blocks.slice(blockIndex, blockIndex + ids.length);
    if (
      ids.length < 2 || new Set(ids).size !== ids.length ||
      ids[0] !== blockId || blocks.length !== ids.length ||
      blocks.some((block, index) => block.id !== ids[index])
    ) {
      return { ok: false, reason: "original_not_found", blockId, original };
    }
    // Use the same separator as editor plain-text selection extraction.
    const combined = blocks.map((block) => block.text).join(" ");
    const hit = locateChatNodeRange(
      { ...doc, blocks: [{ ...blocks[0], text: combined }] },
      { ...node, rangeLocator: { ...locator, blockIds: undefined } },
    );
    if (!hit.ok) return hit;
    const segments: LocatedRange[] = [];
    let offset = 0;
    for (const block of blocks) {
      const start = Math.max(0, hit.start - offset);
      const end = Math.min(block.text.length, hit.end - offset);
      if (end > start) segments.push({ blockId: block.id, start, end });
      offset += block.text.length + 1;
    }
    if (segments.length === 0) {
      return { ok: false, reason: "original_not_found", blockId, original };
    }
    return { ok: true, ...segments[0], segments };
  }
  if (!locator || !isValidSnapshot(locator, original)) {
    return locateRange(doc, { type: "range", blockId, original });
  }

  const currentText = doc.blocks[blockIndex].text;
  const snapshot = locator.blockText;

  // An unchanged block is the strongest possible proof. Duplicate text is
  // harmless because the editor recorded the exact occurrence locally.
  if (currentText === snapshot) {
    return located(blockId, locator.start, locator.end);
  }

  // If the selection lies entirely inside an unchanged leading/trailing
  // region, map it directly across edits on the other side.
  const prefixLength = commonPrefixLength(snapshot, currentText);
  if (locator.end <= prefixLength) {
    return located(blockId, locator.start, locator.end);
  }

  const suffixLength = commonSuffixLength(
    snapshot,
    currentText,
    prefixLength,
  );
  if (locator.start >= snapshot.length - suffixLength) {
    const delta = currentText.length - snapshot.length;
    const start = locator.start + delta;
    const end = locator.end + delta;
    if (currentText.slice(start, end) === original) {
      return located(blockId, start, end);
    }
  }

  // Prefer the exact context captured at selection time. If one side was
  // edited, allow the untouched side to disambiguate on its own.
  const contextual = locateInText(
    currentText,
    original,
    locator.prefix,
    locator.suffix,
  );
  if (contextual.ok) return located(blockId, contextual.start, contextual.end);

  const oneSided = [
    locateInText(currentText, original, locator.prefix, undefined),
    locateInText(currentText, original, undefined, locator.suffix),
  ].filter((candidate) => candidate.ok);
  if (oneSided.length > 0) {
    const starts = new Set(oneSided.map((candidate) => candidate.start));
    if (starts.size === 1) {
      const candidate = oneSided[0];
      return located(blockId, candidate.start, candidate.end);
    }
  }

  const occurrences = findOccurrences(currentText, original);
  if (occurrences.length === 0) {
    return { ok: false, reason: "original_not_found", blockId, original };
  }
  if (occurrences.length === 1) {
    const start = occurrences[0];
    return located(blockId, start, start + original.length);
  }

  // Nearby context may have changed slightly. Compare every occurrence with
  // the full snapshot and accept only a uniquely stronger candidate.
  const before = snapshot.slice(0, locator.start);
  const after = snapshot.slice(locator.end);
  const ranked = occurrences
    .map((start) => ({
      start,
      score:
        commonSuffixLength(before, currentText.slice(0, start), 0) +
        commonPrefixLength(
          after,
          currentText.slice(start + original.length),
        ),
    }))
    .sort((a, b) => b.score - a.score);
  if (
    ranked[0].score >= MIN_FUZZY_CONTEXT &&
    ranked[0].score > ranked[1].score
  ) {
    return located(
      blockId,
      ranked[0].start,
      ranked[0].start + original.length,
    );
  }

  return {
    ok: false,
    reason: "ambiguous",
    blockId,
    original,
    occurrences: occurrences.length,
  };
}

function isValidSnapshot(
  locator: ChatRangeLocator,
  original: string,
): boolean {
  return (
    locator.start >= 0 &&
    locator.end > locator.start &&
    locator.end <= locator.blockText.length &&
    locator.blockText.slice(locator.start, locator.end) === original
  );
}

function located(blockId: string, start: number, end: number): AnchorResult {
  return { ok: true, blockId, start, end };
}

function findOccurrences(text: string, original: string): number[] {
  const starts: number[] = [];
  let from = 0;
  while (from <= text.length - original.length) {
    const start = text.indexOf(original, from);
    if (start < 0) break;
    starts.push(start);
    from = start + 1;
  }
  return starts;
}

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let index = 0;
  while (index < limit && a[index] === b[index]) index += 1;
  return index;
}

function commonSuffixLength(
  a: string,
  b: string,
  protectedPrefixLength: number,
): number {
  const limit = Math.min(a.length, b.length) - protectedPrefixLength;
  let length = 0;
  while (
    length < limit &&
    a[a.length - 1 - length] === b[b.length - 1 - length]
  ) {
    length += 1;
  }
  return length;
}
