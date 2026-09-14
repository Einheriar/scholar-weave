"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DocumentEditor,
  type DocumentEditorHandle,
} from "@/components/editor/DocumentEditor";
import { ReviewSidebar } from "@/components/review/ReviewSidebar";
import type { DocumentState, ReviewItem } from "@/lib/review-schema";
import type { ReviewMode } from "@/lib/llm/review-llm-schema";
import { buildSampleDocument, buildSampleReview } from "@/lib/sample-data";
import { canLocateScope } from "@/lib/anchoring";
import { loadLatestDocument, saveDocument } from "@/lib/storage/documents";

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

/**
 * 阶段 3 主界面：接入真实 LLM 审阅。
 * 顶栏可选审阅模式并触发 /api/review；结果替换侧栏建议；
 * 文本在审阅后若被改动，无法定位的建议自动标 stale（PLAN 10.5）。
 */
export default function Home() {
  const [doc, setDoc] = useState<DocumentState | null>(null);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const [mode, setMode] = useState<ReviewMode>("deep_review");
  const [reviewUi, setReviewUi] = useState<ReviewUiState>({ phase: "idle" });
  const editorRef = useRef<DocumentEditorHandle>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 启动：恢复最近草稿，否则载入样例文档
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
    setReviews((rs) =>
      rs.map((r) =>
        r.status === "open" && !canLocateScope(next, r.scope)
          ? { ...r, status: "stale" as const }
          : r,
      ),
    );
  }, []);

  useEffect(() => {
    if (!doc || saveState !== "saving") return;
    const t = setTimeout(async () => {
      await saveDocument(doc);
      setSaveState("saved");
    }, 500);
    return () => clearTimeout(t);
  }, [doc, saveState]);

  // 触发真实 LLM 审阅
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

  const loadSample = useCallback(() => {
    const { doc: d } = buildSampleDocument();
    setDoc(d);
    setReviews(buildSampleReview(d));
    setSelectedId(null);
    setReviewUi({ phase: "idle" });
    setSaveState("saving");
  }, []);

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
      {/* 顶栏：标题 / 审阅模式 / 开始审阅 / 复制 */}
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
        <DocumentEditor
          ref={editorRef}
          document={doc}
          onDocumentChange={handleDocChange}
          reviewItems={reviews}
          selectedReviewId={selectedId}
          onSelectReview={setSelectedId}
        />
        <div className="min-h-[60vh] lg:min-h-0">
          <ReviewSidebar
            items={reviews}
            selectedId={selectedId}
            onSelect={handleSelect}
            onAccept={handleAccept}
            onReject={handleReject}
            onRevert={handleRevert}
          />
        </div>
      </div>

      <footer className="mt-3 text-xs text-neutral-400">
        阶段 3：真实 LLM 审阅（DeepSeek） · revision {doc.revision} ·{" "}
        {doc.blocks.length} 段 · 文档内容会发送至所选 LLM 供应商
      </footer>
    </main>
  );
}
