"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DocumentEditor,
  type DocumentEditorHandle,
} from "@/components/editor/DocumentEditor";
import { ReviewSidebar } from "@/components/review/ReviewSidebar";
import type { DocumentState, ReviewItem } from "@/lib/review-schema";
import { buildSampleDocument, buildSampleReview } from "@/lib/sample-data";
import { canLocateScope } from "@/lib/anchoring";
import { loadLatestDocument, saveDocument } from "@/lib/storage/documents";

/**
 * 阶段 2 主界面：编辑器 + 审阅侧栏，用固定假数据演示
 * 三层建议、双向定位、接受/忽略/撤销与过期处理（不接 LLM）。
 */
export default function Home() {
  const [doc, setDoc] = useState<DocumentState | null>(null);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const editorRef = useRef<DocumentEditorHandle>(null);

  // 启动：恢复最近草稿，否则载入样例文档；并据当前文档生成假建议
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const restored = await loadLatestDocument();
      if (cancelled) return;
      const base = restored ?? buildSampleDocument().doc;
      setDoc(base);
      setReviews(buildSampleReview(base));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDocChange = useCallback((next: DocumentState) => {
    setDoc(next);
    setSaveState("saving");
    // 文本变化后，将无法再可靠定位的建议标记为过期（PLAN 10.3）
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

  // 侧栏 → 正文定位
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

  // 接受：edit 才执行替换；opinion 仅标记
  const handleAccept = useCallback((id: string) => {
    setReviews((rs) => {
      const item = rs.find((r) => r.id === id);
      if (!item || item.status !== "open") return rs;
      if (item.kind === "edit") {
        const ok = editorRef.current?.applyEdit(item);
        if (!ok) {
          // 应用失败（定位不到等）：保持 open，不动
          return rs;
        }
        // 替换成功后由 onUpdate 触发 handleDocChange，那里会推进 revision
        // 并把不再可定位的建议标 stale；本条标记 accepted。
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

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6">
      {/* 顶栏 */}
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={doc.title}
          onChange={(e) => setDoc({ ...doc, title: e.target.value })}
          className="w-full max-w-sm border-b border-transparent bg-transparent text-lg font-semibold focus:border-neutral-300 focus:outline-none"
          aria-label="文档标题"
        />
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
        阶段 2：静态建议原型（固定假数据，未接 LLM） · revision {doc.revision} ·{" "}
        {doc.blocks.length} 段
      </footer>
    </main>
  );
}
