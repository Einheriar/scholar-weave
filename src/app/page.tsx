"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DocumentEditor,
  type DocumentEditorHandle,
} from "@/components/editor/DocumentEditor";
import { ReviewSidebar } from "@/components/review/ReviewSidebar";
import { ChangeSetPreview } from "@/components/review/ChangeSetPreview";
import { ContextChat, type ChatTurn } from "@/components/chat/ContextChat";
import type {
  ChangeSet,
  ChatContext,
  DocumentState,
  ReviewItem,
} from "@/lib/review-schema";
import type { ReviewMode } from "@/lib/llm/review-llm-schema";
import { buildSampleDocument, buildSampleReview } from "@/lib/sample-data";
import { canLocateScope } from "@/lib/anchoring";
import { computeChangeSetApplication } from "@/lib/changeset";
import {
  clearAllDocuments,
  loadLatestDocument,
  saveDocument,
} from "@/lib/storage/documents";

type ReviewUiState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "done"; summary: string }
  | { phase: "error"; message: string };

const MODE_LABEL: Record<ReviewMode, string> = {
  proofread: "仅纠错",
  polish: "适度润色",
  deep_review: "深度审阅",
};

type Selection = { blockId: string; text: string } | null;

export default function Home() {
  const [doc, setDoc] = useState<DocumentState | null>(null);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [mode, setMode] = useState<ReviewMode>("deep_review");
  const [reviewUi, setReviewUi] = useState<ReviewUiState>({ phase: "idle" });

  // 对话与修改集
  const [selection, setSelection] = useState<Selection>(null);
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [applyingOpinionId, setApplyingOpinionId] = useState<string | null>(null);
  const [activeChangeSet, setActiveChangeSet] = useState<ChangeSet | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  const editorRef = useRef<DocumentEditorHandle>(null);
  const abortRef = useRef<AbortController | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);

  // ── 启动：恢复最近草稿，否则载入样例 ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const restored = await loadLatestDocument();
      if (cancelled) return;
      const base = restored ?? buildSampleDocument().doc;
      setDoc(base);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDocChange = useCallback((next: DocumentState) => {
    setDoc(next);
    setSaveState("saving");
    // 文本变化后，无法定位的 open 建议标记过期（PLAN 10.3/10.4）
    setReviews((rs) =>
      rs.map((r) =>
        r.status === "open" && !canLocateScope(next, r.scope)
          ? { ...r, status: "stale" as const }
          : r,
      ),
    );
  }, []);

  // 防抖保存草稿
  useEffect(() => {
    if (!doc || saveState !== "saving") return;
    const t = setTimeout(async () => {
      await saveDocument(doc);
      setSaveState("saved");
    }, 500);
    return () => clearTimeout(t);
  }, [doc, saveState]);

  // ── 审阅 ──
  const runReview = useCallback(async () => {
    if (!doc) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setReviewUi({ phase: "loading" });
    setSelectedId(null);
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          documentId: doc.id,
          revision: doc.revision,
          checksum: doc.checksum,
          mode,
          language: "en",
          style: "学术",
          preserveTerms: [],
          blocks: doc.blocks.map((b) => ({ id: b.id, text: b.text })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? `审阅失败（HTTP ${res.status}）`);
      }
      setReviews(data.items as ReviewItem[]);
      setReviewUi({ phase: "done", summary: data.documentSummary ?? "" });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        setReviewUi({ phase: "idle" });
        return;
      }
      setReviewUi({
        phase: "error",
        message: e instanceof Error ? e.message : "审阅失败。",
      });
    }
  }, [doc, mode]);

  const cancelReview = useCallback(() => {
    abortRef.current?.abort();
    setReviewUi({ phase: "idle" });
  }, []);

  // ── 建议定位 / 状态 ──
  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    setReviews((rs) => {
      const item = rs.find((r) => r.id === id);
      if (item && item.scope.type !== "document") {
        editorRef.current?.revealItem(item);
      }
      return rs;
    });
  }, []);

  const handleAccept = useCallback((id: string) => {
    setReviews((rs) => {
      const item = rs.find((r) => r.id === id);
      if (!item || item.status !== "open") return rs;
      if (item.kind === "edit") {
        const ok = editorRef.current?.applyEdit(item);
        if (!ok) return rs;
      }
      return rs.map((r) =>
        r.id === id ? { ...r, status: "accepted" as const } : r,
      );
    });
  }, []);

  const handleReject = useCallback((id: string) => {
    setReviews((rs) =>
      rs.map((r) =>
        r.id === id && r.status === "open"
          ? { ...r, status: "rejected" as const }
          : r,
      ),
    );
  }, []);

  const handleRevert = useCallback((id: string) => {
    setReviews((rs) =>
      rs.map((r) =>
        r.id === id && (r.status === "accepted" || r.status === "rejected")
          ? { ...r, status: "open" as const }
          : r,
      ),
    );
  }, []);

  // ── 上下文计算：选区 > 建议 > 全文 ──
  const chatContext: ChatContext = useMemo(() => {
    if (selection && selection.text.trim()) {
      return {
        type: "range",
        blockId: selection.blockId,
        selectedText: selection.text,
      };
    }
    if (selectedId) {
      const item = reviews.find((r) => r.id === selectedId);
      if (item) {
        if (item.scope.type === "block" || item.scope.type === "range") {
          return { type: "review", reviewId: item.id, blockId: item.scope.blockId };
        }
        return { type: "review", reviewId: item.id };
      }
    }
    return { type: "document" };
  }, [selection, selectedId, reviews]);

  const contextReview = useMemo(
    () =>
      chatContext.type === "review"
        ? reviews.find((r) => r.id === chatContext.reviewId) ?? null
        : null,
    [chatContext, reviews],
  );

  /** 按上下文打包要发送给模型的段落 */
  const packBlocks = useCallback(
    (ctx: ChatContext): Array<{ id: string; text: string }> => {
      if (!doc) return [];
      const all = doc.blocks.map((b) => ({ id: b.id, text: b.text }));
      if (ctx.type === "document") return all;
      const bid = ctx.blockId;
      if (!bid) return all;
      const idx = doc.blocks.findIndex((b) => b.id === bid);
      if (idx < 0) return all;
      // 段落/选区/建议：发送该段 + 相邻段作为上下文
      const from = Math.max(0, idx - 1);
      const to = Math.min(doc.blocks.length, idx + 2);
      return doc.blocks.slice(from, to).map((b) => ({ id: b.id, text: b.text }));
    },
    [doc],
  );

  // ── 对话 ──
  const sendChat = useCallback(
    async (message: string) => {
      if (!doc) return;
      const ctx = chatContext;
      const blocks = packBlocks(ctx);
      const history = chatTurns
        .map((t) => ({ role: t.role, content: t.content }))
        .slice(-8);

      setChatTurns((ts) => [...ts, { role: "user", content: message }]);
      setChatBusy(true);
      setChatError(null);
      chatAbortRef.current?.abort();
      const controller = new AbortController();
      chatAbortRef.current = controller;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            documentId: doc.id,
            revision: doc.revision,
            checksum: doc.checksum,
            context: ctx,
            message,
            history,
            blocks,
            reviewItem: contextReview
              ? {
                  id: contextReview.id,
                  title: contextReview.title,
                  explanation: contextReview.explanation,
                  category: contextReview.category,
                }
              : undefined,
            language: "en",
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error?.message ?? `对话失败（HTTP ${res.status}）`);
        }
        if (data.type === "answer_with_changes" && data.changeSet) {
          setChatTurns((ts) => [
            ...ts,
            { role: "assistant", content: data.answer, changeSet: data.changeSet },
          ]);
        } else {
          setChatTurns((ts) => [
            ...ts,
            { role: "assistant", content: data.answer ?? "" },
          ]);
        }
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
          // 用户取消：不加错误
        } else {
          setChatError(e instanceof Error ? e.message : "对话失败。");
        }
      } finally {
        setChatBusy(false);
      }
    },
    [doc, chatContext, chatTurns, contextReview, packBlocks],
  );

  // ── 按意见生成修改集（opinion → ChangeSet）──
  const applyOpinion = useCallback(
    async (id: string) => {
      if (!doc) return;
      const item = reviews.find((r) => r.id === id);
      if (!item) return;
      // 收窄出 blockId（document 级没有）
      const scopeBlockId =
        item.scope.type === "block" || item.scope.type === "range"
          ? item.scope.blockId
          : undefined;
      setApplyingOpinionId(id);
      setChatError(null);
      try {
        const res = await fetch("/api/change-set", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documentId: doc.id,
            revision: doc.revision,
            checksum: doc.checksum,
            sourceReview: {
              id: item.id,
              title: item.title,
              explanation: item.explanation,
              category: item.category,
              scope:
                item.scope.type === "document"
                  ? { type: "document" }
                  : { type: item.scope.type, blockId: scopeBlockId },
            },
            blocks:
              item.scope.type === "document"
                ? doc.blocks.map((b) => ({ id: b.id, text: b.text }))
                : packBlocks({ type: "review", reviewId: id, blockId: scopeBlockId }),
            language: "en",
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error?.message ?? `生成修改失败（HTTP ${res.status}）`);
        }
        setActiveChangeSet(data.changeSet as ChangeSet);
      } catch (e) {
        setChatError(e instanceof Error ? e.message : "生成修改集失败。");
      } finally {
        setApplyingOpinionId(null);
      }
    },
    [doc, reviews, packBlocks],
  );

  // ── 修改集：接受选中 / 放弃 ──
  const acceptChangeSet = useCallback(
    (editIds: string[]) => {
      if (!doc || !activeChangeSet) return;
      const subset: ChangeSet = {
        ...activeChangeSet,
        edits: activeChangeSet.edits.filter((e) => editIds.includes(e.id)),
      };
      const { newTextByBlock } = computeChangeSetApplication(doc, subset);
      if (newTextByBlock.size === 0) return;
      editorRef.current?.applyBlockTexts(newTextByBlock);
      // 与源意见关联：接受后把该意见标记为 accepted
      if (activeChangeSet.sourceReviewId) {
        const sid = activeChangeSet.sourceReviewId;
        setReviews((rs) =>
          rs.map((r) =>
            r.id === sid ? { ...r, status: "accepted" as const } : r,
          ),
        );
      }
      setActiveChangeSet(null);
    },
    [doc, activeChangeSet],
  );

  const discardChangeSet = useCallback(() => setActiveChangeSet(null), []);

  // ── 复制全文 / 清空数据 ──
  const copyAll = useCallback(async () => {
    if (!doc) return;
    const text = doc.blocks.map((b) => b.text).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1500);
    } catch {
      setChatError("复制失败，请检查浏览器剪贴板权限。");
    }
  }, [doc]);

  const clearAll = useCallback(async () => {
    if (!window.confirm("确定要清空本地保存的草稿与数据吗？当前编辑器内容也会被重置。")) {
      return;
    }
    await clearAllDocuments();
    const { doc: d } = buildSampleDocument();
    setDoc(d);
    setReviews([]);
    setChatTurns([]);
    setActiveChangeSet(null);
    setSelectedId(null);
    setReviewUi({ phase: "idle" });
    setSaveState("saving");
  }, []);

  const loadSample = useCallback(() => {
    const { doc: d } = buildSampleDocument();
    setDoc(d);
    setReviews(buildSampleReview(d));
    setSelectedId(null);
    setReviewUi({ phase: "idle" });
    setSaveState("saving");
  }, []);

  const openCount = useMemo(
    () => reviews.filter((r) => r.status === "open").length,
    [reviews],
  );

  if (!doc) {
    return (
      <main className="flex min-h-screen items-center justify-center text-neutral-500">
        正在载入草稿…
      </main>
    );
  }

  const loading = reviewUi.phase === "loading";

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6">
      {/* 顶栏 */}
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={doc.title}
          onChange={(e) => setDoc({ ...doc, title: e.target.value })}
          className="w-full max-w-xs border-b border-transparent bg-transparent text-lg font-semibold focus:border-neutral-300 focus:outline-none"
          aria-label="文档标题"
        />
        <label className="flex items-center gap-1 text-xs text-neutral-600">
          审阅模式
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as ReviewMode)}
            disabled={loading}
            className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs focus:border-blue-400 focus:outline-none"
            aria-label="审阅模式"
          >
            {(Object.keys(MODE_LABEL) as ReviewMode[]).map((m) => (
              <option key={m} value={m}>
                {MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </label>

        {loading ? (
          <button
            type="button"
            onClick={cancelReview}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
          >
            取消审阅
          </button>
        ) : (
          <button
            type="button"
            onClick={runReview}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            开始审阅
          </button>
        )}

        <button
          type="button"
          onClick={copyAll}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
        >
          {copyState === "copied" ? "已复制 ✓" : "复制全文"}
        </button>

        <button
          type="button"
          onClick={loadSample}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
        >
          载入样例
        </button>

        <div className="ml-auto flex items-center gap-3 text-xs text-neutral-400">
          <span>{openCount} 条待处理</span>
          <span role="status">
            {saveState === "saving"
              ? "保存中…"
              : saveState === "saved"
                ? "已保存到本地"
                : ""}
          </span>
          <button
            type="button"
            onClick={clearAll}
            className="text-neutral-400 underline hover:text-red-500"
          >
            清空数据
          </button>
        </div>
      </header>

      {/* 审阅状态条 */}
      {reviewUi.phase === "loading" && (
        <p className="mb-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700" role="status">
          正在审阅文档…（LLM 生成中，可点击“取消审阅”）
        </p>
      )}
      {reviewUi.phase === "error" && (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {reviewUi.message}
        </p>
      )}
      {reviewUi.phase === "done" && reviewUi.summary && (
        <p className="mb-3 rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-700">
          <span className="font-medium">全文总结：</span>
          {reviewUi.summary}
        </p>
      )}

      {/* 主体：编辑器 + 侧栏 */}
      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-3">
          <DocumentEditor
            ref={editorRef}
            document={doc}
            onDocumentChange={handleDocChange}
            reviewItems={reviews}
            selectedReviewId={selectedId}
            onSelectReview={setSelectedId}
            onSelectionChange={setSelection}
          />

          {/* 修改集预览（对话或按意见生成时弹出） */}
          {activeChangeSet && (
            <ChangeSetPreview
              changeSet={activeChangeSet}
              document={doc}
              onAccept={acceptChangeSet}
              onDiscard={discardChangeSet}
            />
          )}

          {/* 上下文对话 */}
          {chatError && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {chatError}
            </p>
          )}
          <ContextChat
            context={chatContext}
            contextReview={contextReview}
            turns={chatTurns}
            busy={chatBusy}
            onSend={sendChat}
            onPreviewChangeSet={(cs) => setActiveChangeSet(cs)}
            onClear={() => setChatTurns([])}
          />
        </div>

        <div className="min-h-[60vh] lg:min-h-0">
          <ReviewSidebar
            items={reviews}
            selectedId={selectedId}
            onSelect={handleSelect}
            onAccept={handleAccept}
            onReject={handleReject}
            onRevert={handleRevert}
            onChat={handleSelect}
            onApplyOpinion={applyOpinion}
            applyingOpinionId={applyingOpinionId}
          />
        </div>
      </div>

      <footer className="mt-3 space-y-1 text-xs text-neutral-400">
        <p>
          阶段 4-6 · revision {doc.revision} · {doc.blocks.length} 段
        </p>
        <p>
          隐私说明：点击“开始审阅”或“发送”后，相关文档内容会发送至所配置的 LLM
          供应商（当前为 DeepSeek）用于生成结果；草稿仅保存在本浏览器本地，不会上传到本服务之外的服务器。
        </p>
      </footer>
    </main>
  );
}
