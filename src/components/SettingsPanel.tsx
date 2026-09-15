"use client";

import { useState, useEffect, useCallback } from "react";
import { buttonClass } from "@/components/ui/button";
import {
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

type Tab = "model" | "review" | "data";

type SettingsPanelProps = {
  open: boolean;
  onClose: () => void;
  settings: UserSettings;
  onSettingsChange: (settings: UserSettings) => void;
  onLoadSample?: () => void;
  onClearAll?: () => void;
};

export function SettingsPanel({
  open,
  onClose,
  settings,
  onSettingsChange,
  onLoadSample,
  onClearAll,
}: SettingsPanelProps) {
  const [tab, setTab] = useState<Tab>("model");
  const [draft, setDraft] = useState<UserSettings>(settings);
  const [saved, setSaved] = useState(false);
  // 面板每次打开时重置 draft：用“上次同步的 settings”做渲染期比对，
  // 只在引用变化时 setState（React 推荐的 derived-state-from-props 模式）
  const [prevSynced, setPrevSynced] = useState<{ open: boolean; settings: UserSettings }>({
    open,
    settings,
  });
  if (open !== prevSynced.open || settings !== prevSynced.settings) {
    setPrevSynced({ open, settings });
    if (open) {
      setDraft(settings);
      setSaved(false);
    }
  }

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
    "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-sm transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring placeholder:text-text-faint";
  const labelCls =
    "block text-xs font-medium text-text-muted mb-1.5";

  const tabs = [
    { key: "model", label: "模型" },
    { key: "review", label: "审阅" },
    { key: "data", label: "数据" },
  ] as const;
  const activeIndex = tabs.findIndex((t) => t.key === tab);

  return (
    <div
      className="animate-modal-fade fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="animate-modal-pop flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-surface shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2
            id="settings-title"
            className="text-lg font-semibold tracking-tight text-foreground"
          >
            设置
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-faint transition-colors hover:bg-surface-muted hover:text-foreground"
            aria-label="关闭设置"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tabs：激活指示条跟随滑动 */}
        <div className="relative flex border-b border-border">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors duration-150 ${
                tab === key
                  ? "text-brand"
                  : "text-text-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
          <span
            aria-hidden
            className="absolute bottom-0 h-0.5 w-1/3 bg-brand transition-transform duration-200 ease-out"
            style={{ transform: `translateX(${activeIndex * 100}%)` }}
          />
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
                <p className="mt-1.5 text-xs text-text-faint">
                  你的 OpenAI 兼容 API 密钥，仅保存在此浏览器本地。
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
                <label className={labelCls}>模型</label>
                <input
                  type="text"
                  value={draft.llm.model}
                  onChange={(e) => updateLLM({ model: e.target.value })}
                  placeholder="deepseek-chat"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>思考档位</label>
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
                <p className="mt-1.5 text-xs text-text-faint">
                  控制模型在回复前的思考深度。档位越高，分析越深入，但响应越慢。
                </p>
              </div>
            </div>
          )}

          {tab === "review" && (
            <div className="space-y-5">
              <div>
                <label className={labelCls}>写作风格</label>
                <input
                  type="text"
                  value={draft.review.style}
                  onChange={(e) => updateReview({ style: e.target.value })}
                  placeholder="例如：学术、正式、简洁"
                  className={inputCls}
                />
                <p className="mt-1.5 text-xs text-text-faint">
                  描述期望的写作风格，供审阅时参考。
                </p>
              </div>
              <div>
                <label className={labelCls}>保留术语</label>
                <input
                  type="text"
                  value={draft.review.preserveTerms}
                  onChange={(e) => updateReview({ preserveTerms: e.target.value })}
                  placeholder="例如：SIT, IDT, social category"
                  className={inputCls}
                />
                <p className="mt-1.5 text-xs text-text-faint">
                  逗号分隔的术语，审阅时必须逐字保留、不得修改。
                </p>
              </div>
              <div>
                <label className={labelCls}>自定义指令</label>
                <textarea
                  value={draft.review.customPrompt}
                  onChange={(e) => updateReview({ customPrompt: e.target.value })}
                  placeholder={"给审阅助手的补充指令...\n\n例如：重点关注被动语态\n     对标点符号严格要求\n     偏好简洁的句子"}
                  rows={8}
                  className={inputCls + " resize-y font-mono"}
                />
                <p className="mt-1.5 text-xs text-text-faint">
                  追加到系统提示末尾。JSON 输出协议和锚点规则已锁定，无法被覆盖。
                </p>
              </div>
            </div>
          )}

          {tab === "data" && (
            <div className="space-y-5">
              <div>
                <label className={labelCls}>示例数据</label>
                <p className="mb-2 text-xs text-text-faint">
                  加载内置的示例论文和审阅建议，用于演示界面效果（不会调用 LLM）。
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onLoadSample?.();
                    onClose();
                  }}
                  className={buttonClass("secondary", "md")}
                >
                  载入样例
                </button>
              </div>
              <div>
                <label className={labelCls}>本地数据</label>
                <p className="mb-2 text-xs text-text-faint">
                  清除浏览器本地保存的草稿，并将编辑器重置为示例文档。此操作不可撤销。
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onClearAll?.();
                    onClose();
                  }}
                  className={buttonClass("danger", "md")}
                >
                  清空数据
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={handleReset}
            className="rounded-md px-2 py-1 text-sm text-text-faint transition-colors hover:bg-surface-muted hover:text-foreground"
          >
            恢复默认
          </button>
          <div className="flex items-center gap-3">
            {saved && (
              <span className="animate-item-in text-sm text-emerald-600 dark:text-emerald-400">
                已保存！
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className={buttonClass("secondary", "md")}
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              className={buttonClass("primary", "md")}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
