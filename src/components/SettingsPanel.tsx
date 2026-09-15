"use client";

import { useState, useEffect, useCallback } from "react";
import {
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  REASONING_EFFORT_OPTIONS,
  type UserSettings,
  type ReasoningEffort,
} from "@/lib/settings";

/**
 * 设置面板：LLM 连接配置 + 审阅偏好。
 * 中央模态窗口，localStorage 持久化。
 */

type Tab = "model" | "review";

type SettingsPanelProps = {
  open: boolean;
  onClose: () => void;
  settings: UserSettings;
  onSettingsChange: (settings: UserSettings) => void;
};

export function SettingsPanel({
  open,
  onClose,
  settings,
  onSettingsChange,
}: SettingsPanelProps) {
  const [tab, setTab] = useState<Tab>("model");
  const [draft, setDraft] = useState<UserSettings>(settings);
  const [saved, setSaved] = useState(false);

  // Sync draft when settings change externally or panel opens
  useEffect(() => {
    if (open) {
      setDraft(settings);
      setSaved(false);
    }
  }, [open, settings]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const updateLLM = useCallback(
    (patch: Partial<UserSettings["llm"]>) => {
      setDraft((d) => ({ ...d, llm: { ...d.llm, ...patch } }));
    },
    [],
  );

  const updateReview = useCallback(
    (patch: Partial<UserSettings["review"]>) => {
      setDraft((d) => ({ ...d, review: { ...d.review, ...patch } }));
    },
    [],
  );

  const handleSave = useCallback(() => {
    saveSettings(draft);
    onSettingsChange(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [draft, onSettingsChange]);

  const handleReset = useCallback(() => {
    setDraft(DEFAULT_SETTINGS);
  }, []);

  if (!open) return null;

  const inputCls =
    "w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm focus:border-blue-400 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200";
  const labelCls =
    "block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-neutral-300 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4 dark:border-neutral-700">
          <h2
            id="settings-title"
            className="text-lg font-semibold text-neutral-800 dark:text-neutral-200"
          >
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
            aria-label="Close settings"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-neutral-200 dark:border-neutral-700">
          {(
            [
              { key: "model", label: "Model" },
              { key: "review", label: "Review" },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                tab === key
                  ? "border-b-2 border-blue-500 text-blue-600 dark:text-blue-400"
                  : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === "model" && (
            <div className="space-y-5">
              <div>
                <label className={labelCls}>API Key</label>
                <input
                  type="password"
                  value={draft.llm.apiKey}
                  onChange={(e) => updateLLM({ apiKey: e.target.value })}
                  placeholder="sk-..."
                  className={inputCls}
                  autoComplete="off"
                />
                <p className="mt-1.5 text-xs text-neutral-400">
                  Your OpenAI-compatible API key. Stored locally in this browser only.
                </p>
              </div>
              <div>
                <label className={labelCls}>Base URL</label>
                <input
                  type="text"
                  value={draft.llm.baseURL}
                  onChange={(e) => updateLLM({ baseURL: e.target.value })}
                  placeholder="https://api.deepseek.com"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Model</label>
                <input
                  type="text"
                  value={draft.llm.model}
                  onChange={(e) => updateLLM({ model: e.target.value })}
                  placeholder="deepseek-chat"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Reasoning Effort</label>
                <select
                  value={draft.llm.reasoningEffort}
                  onChange={(e) =>
                    updateLLM({ reasoningEffort: e.target.value as ReasoningEffort })
                  }
                  className={inputCls}
                >
                  {REASONING_EFFORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} — {opt.description}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-neutral-400">
                  Controls how much the model thinks before responding. Higher effort = deeper analysis but slower.
                </p>
              </div>
            </div>
          )}

          {tab === "review" && (
            <div className="space-y-5">
              <div>
                <label className={labelCls}>Writing Style</label>
                <input
                  type="text"
                  value={draft.review.style}
                  onChange={(e) => updateReview({ style: e.target.value })}
                  placeholder="e.g. Academic, Formal, Concise"
                  className={inputCls}
                />
                <p className="mt-1.5 text-xs text-neutral-400">
                  Describe the target writing style for the reviewer.
                </p>
              </div>
              <div>
                <label className={labelCls}>Preserve Terms</label>
                <input
                  type="text"
                  value={draft.review.preserveTerms}
                  onChange={(e) => updateReview({ preserveTerms: e.target.value })}
                  placeholder="e.g. SIT, IDT, social category"
                  className={inputCls}
                />
                <p className="mt-1.5 text-xs text-neutral-400">
                  Comma-separated terms that must be preserved verbatim.
                </p>
              </div>
              <div>
                <label className={labelCls}>Custom Instructions</label>
                <textarea
                  value={draft.review.customPrompt}
                  onChange={(e) => updateReview({ customPrompt: e.target.value })}
                  placeholder={"Additional instructions for the reviewer...\n\ne.g. Focus on passive voice\n     Be strict about comma usage\n     Prefer concise sentences"}
                  rows={8}
                  className={inputCls + " resize-y font-mono"}
                />
                <p className="mt-1.5 text-xs text-neutral-400">
                  Appended to the system prompt. The JSON output protocol and anchor
                  rules are locked and cannot be overridden.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-neutral-200 px-6 py-4 dark:border-neutral-700">
          <button
            type="button"
            onClick={handleReset}
            className="text-sm text-neutral-400 transition-colors hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            Reset to defaults
          </button>
          <div className="flex items-center gap-3">
            {saved && (
              <span className="text-sm text-green-600 dark:text-green-400">
                Saved!
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
