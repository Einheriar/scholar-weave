"use client";

import { useCallback, useEffect, useState } from "react";
import { DocumentEditor } from "@/components/editor/DocumentEditor";
import type { DocumentState } from "@/lib/review-schema";
import { createDocument } from "@/lib/revisions";
import { loadLatestDocument, saveDocument } from "@/lib/storage/documents";

export default function Home() {
  const [doc, setDoc] = useState<DocumentState | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );

  // 启动时恢复最近草稿；没有则新建
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const restored = await loadLatestDocument();
      if (cancelled) return;
      setDoc(restored ?? createDocument("未命名文档", [""]));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = useCallback((next: DocumentState) => {
    setDoc(next);
    setSaveState("saving");
  }, []);

  // 防抖保存到 IndexedDB
  useEffect(() => {
    if (!doc || saveState !== "saving") return;
    const t = setTimeout(async () => {
      await saveDocument(doc);
      setSaveState("saved");
    }, 500);
    return () => clearTimeout(t);
  }, [doc, saveState]);

  if (!doc) {
    return (
      <main className="flex min-h-screen items-center justify-center text-neutral-500">
        正在载入草稿…
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-4 flex items-center justify-between">
        <input
          value={doc.title}
          onChange={(e) => setDoc({ ...doc, title: e.target.value })}
          className="w-full max-w-xs border-b border-transparent bg-transparent text-lg font-semibold focus:border-neutral-300 focus:outline-none"
          aria-label="文档标题"
        />
        <span className="text-xs text-neutral-400" role="status">
          {saveState === "saving"
            ? "保存中…"
            : saveState === "saved"
              ? "已保存到本地"
              : ""}
        </span>
      </header>

      <DocumentEditor document={doc} onDocumentChange={handleChange} />

      <footer className="mt-3 text-xs text-neutral-400">
        阶段 1：稳定段落编辑器 · revision {doc.revision} · checksum{" "}
        {doc.checksum} · {doc.blocks.length} 段
      </footer>
    </main>
  );
}
