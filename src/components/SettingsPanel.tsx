"use client";

import { useState, useEffect, useCallback } from "react";
import { buttonClass } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { renderMiniMarkdown } from "@/lib/mini-markdown";
import {
  saveSettings,
  DEFAULT_SETTINGS,
  REASONING_EFFORT_OPTIONS,
  createPreset,
  getActivePreset,
  type LLMPreset,
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
  /** 请求期间禁止会替换当前文章的数据操作。 */
  dataActionsLocked?: boolean;
};

export function SettingsPanel({
  open,
  onClose,
  settings,
  onSettingsChange,
  onLoadSample,
  onClearAll,
  dataActionsLocked = false,
}: SettingsPanelProps) {
  const [tab, setTab] = useState<Tab>("model");
  const [draft, setDraft] = useState<UserSettings>(settings);
  const [saved, setSaved] = useState(false);
  // 自定义指令框「双层」状态：聚焦编辑源文本（等宽），失焦渲染 markdown 预览。
  // 底层存储与发送的始终是源文本，渲染只影响前端显示。
  const [customPromptFocused, setCustomPromptFocused] = useState(false);
  // 切换预设时的刷新感：key 变化触发下方字段容器的 animate-item-in 重播
  const [presetSwitchTick, setPresetSwitchTick] = useState(0);
  // 测试连接状态
  const [testStatus, setTestStatus] = useState<"idle" | "testing">("idle");
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
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

  const updateActivePreset = useCallback((patch: Partial<LLMPreset>) => {
    setDraft((d) => ({
      ...d,
      llm: {
        ...d.llm,
        presets: d.llm.presets.map((p) =>
          p.id === d.llm.activeId ? { ...p, ...patch } : p,
        ),
      },
    }));
  }, []);

  const handleAddPreset = useCallback(() => {
    setDraft((d) => {
      const preset = createPreset(`配置 ${d.llm.presets.length + 1}`);
      return {
        ...d,
        llm: { activeId: preset.id, presets: [...d.llm.presets, preset] },
      };
    });
  }, []);

  const handleDeletePreset = useCallback(() => {
    setDraft((d) => {
      if (d.llm.presets.length <= 1) return d;
      const presets = d.llm.presets.filter((p) => p.id !== d.llm.activeId);
      return { ...d, llm: { activeId: presets[0].id, presets } };
    });
  }, []);

  /** 测试当前选中预设的连接（含代理）：发一个极小的请求探测连通性 */
  const handleTestConnection = useCallback(async () => {
    const preset = getActivePreset(draft);
    if (!preset.apiKey || testStatus === "testing") return;
    setTestStatus("testing");
    setTestResult(null);
    try {
      const res = await fetch("/api/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          llmConfig: {
            apiKey: preset.apiKey,
            baseURL: preset.baseURL || undefined,
            model: preset.model || undefined,
            reasoningEffort: preset.reasoningEffort,
            proxy: preset.proxy.enabled
              ? { type: preset.proxy.type, host: preset.proxy.host, port: preset.proxy.port }
              : undefined,
          },
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setTestResult({ ok: true, message: "连接成功" });
      } else {
        setTestResult({
          ok: false,
          message: data?.error?.message ?? `连接失败（HTTP ${res.status}）`,
        });
      }
    } catch (e) {
      setTestResult({
        ok: false,
        message: e instanceof Error ? e.message : "连接失败。",
      });
    } finally {
      setTestStatus("idle");
      // 15 秒后自动清除结果
      setTimeout(() => setTestResult(null), 15000);
    }
  }, [draft, testStatus]);

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
  const activePreset = getActivePreset(draft);

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
              {/* 配置预设选择器：切换只改 activeId，各预设的 Key/模型/代理各自保留。
                  视觉上与其他字段平级——一个预设包含下面所有字段，不分组。 */}
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <label className={labelCls}>当前配置</label>
                  <Select
                    value={draft.llm.activeId}
                    onChange={(id) => {
                      setDraft((d) => ({
                        ...d,
                        llm: { ...d.llm, activeId: id },
                      }));
                      setPresetSwitchTick((t) => t + 1);
                    }}
                    options={draft.llm.presets.map((p) => ({
                      value: p.id,
                      label: p.name,
                    }))}
                    ariaLabel="当前配置"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAddPreset}
                  className={buttonClass("secondary", "md") + " shrink-0"}
                >
                  + 新建
                </button>
                <button
                  type="button"
                  onClick={handleDeletePreset}
                  disabled={draft.llm.presets.length <= 1}
                  className={buttonClass("danger", "md") + " shrink-0"}
                >
                  删除
                </button>
              </div>

              {/* 切换预设时给字段容器一个入场动画，让切换有"内容刷新了"的感知 */}
              <div key={presetSwitchTick} className="animate-item-in space-y-5">
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <label className={labelCls}>配置名称</label>
                  <input
                    type="text"
                    value={activePreset.name}
                    onChange={(e) =>
                      updateActivePreset({ name: e.target.value })
                    }
                    placeholder="例如：DeepSeek 主力号"
                    className={inputCls}
                  />
                </div>
                <div className="flex shrink-0 items-center gap-2 pb-0.5">
                  <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={testStatus === "testing" || !activePreset.apiKey}
                    className={buttonClass("secondary", "md")}
                  >
                    {testStatus === "testing" ? "测试中…" : "测试连接"}
                  </button>
                </div>
              </div>
              {testResult && (
                <p
                  className={
                    "-mt-3 text-xs " +
                    (testResult.ok
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400")
                  }
                >
                  {testResult.message}
                </p>
              )}
              <p className="-mt-3 text-xs text-text-faint">
                预设会记住各自的 Key / 地址 / 模型 / 代理，切换不会互相覆盖。
              </p>

              <div>
                <label className={labelCls}>API Key</label>
                <input
                  type="password"
                  value={activePreset.apiKey}
                  onChange={(e) =>
                    updateActivePreset({ apiKey: e.target.value })
                  }
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
                  value={activePreset.baseURL}
                  onChange={(e) =>
                    updateActivePreset({ baseURL: e.target.value })
                  }
                  placeholder="https://api.deepseek.com"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>模型</label>
                <input
                  type="text"
                  value={activePreset.model}
                  onChange={(e) =>
                    updateActivePreset({ model: e.target.value })
                  }
                  placeholder="deepseek-chat"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>思考档位</label>
                <Select
                  value={activePreset.reasoningEffort}
                  onChange={(v) =>
                    updateActivePreset({
                      reasoningEffort: v as ReasoningEffort,
                    })
                  }
                  options={REASONING_EFFORT_OPTIONS.map((opt) => ({
                    value: opt.value,
                    label: `${opt.label} — ${opt.description}`,
                  }))}
                  ariaLabel="思考档位"
                />
                <p className="mt-1.5 text-xs text-text-faint">
                  控制模型在回复前的思考深度。「默认」不传参交给模型；「不思考」会请求关闭思考（不支持的提供商会报错）。
                </p>
              </div>

              {/* 代理：只影响服务端 → LLM 供应商的请求，不影响浏览器本身的网络 */}
              <div>
                <label className={labelCls}>代理</label>
                <div className="flex items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-1.5 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={activePreset.proxy.enabled}
                      onChange={(e) =>
                        updateActivePreset({
                          proxy: { ...activePreset.proxy, enabled: e.target.checked },
                        })
                      }
                      className="accent-[#0da678]"
                    />
                    启用代理
                  </label>
                  {activePreset.proxy.enabled && (
                    <Select
                      value={activePreset.proxy.type}
                      onChange={(v) =>
                        updateActivePreset({
                          proxy: {
                            ...activePreset.proxy,
                            type: v as "http" | "socks5",
                          },
                        })
                      }
                      options={[
                        { value: "http", label: "HTTP" },
                        { value: "socks5", label: "SOCKS5" },
                      ]}
                      ariaLabel="代理类型"
                    />
                  )}
                </div>
                {activePreset.proxy.enabled && (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="text"
                      value={activePreset.proxy.host}
                      onChange={(e) =>
                        updateActivePreset({
                          proxy: { ...activePreset.proxy, host: e.target.value },
                        })
                      }
                      placeholder="127.0.0.1"
                      className={inputCls.replace("w-full", "min-w-0 flex-1 w-auto")}
                      aria-label="代理主机"
                    />
                    <input
                      type="number"
                      value={activePreset.proxy.port}
                      onChange={(e) => {
                        const p = parseInt(e.target.value, 10);
                        if (!isNaN(p) && p > 0 && p < 65536) {
                          updateActivePreset({
                            proxy: { ...activePreset.proxy, port: p },
                          });
                        }
                      }}
                      placeholder="7890"
                      className={inputCls.replace("w-full", "w-24 shrink-0")}
                      aria-label="代理端口"
                    />
                  </div>
                )}
                <p className="mt-1.5 text-xs text-text-faint">
                  仅用于服务端连接 LLM 供应商，不影响浏览器本身的网络。浏览器插件代理管不到 LLM 请求。
                </p>
              </div>
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
                <div className="relative">
                  <textarea
                    value={draft.review.customPrompt}
                    onChange={(e) => updateReview({ customPrompt: e.target.value })}
                    onFocus={() => setCustomPromptFocused(true)}
                    onBlur={() => setCustomPromptFocused(false)}
                    placeholder={"给审阅助手的补充指令...\n\n支持 markdown 格式（# 标题、- 列表、**加粗** 等）。\n失焦时预览渲染效果，聚焦时编辑原文。\n\n例如：for example 不用 for instance\n     更倾向 neural activity"}
                    rows={8}
                    className={
                      inputCls +
                      " resize-y font-mono " +
                      (customPromptFocused ||
                      !draft.review.customPrompt.trim()
                        ? ""
                        : "invisible")
                    }
                  />
                  {!customPromptFocused &&
                    draft.review.customPrompt.trim() && (
                      <div
                        role="presentation"
                        tabIndex={-1}
                        className="absolute inset-0 cursor-text overflow-y-auto rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-sm"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setCustomPromptFocused(true);
                        }}
                      >
                        {renderMiniMarkdown(draft.review.customPrompt)}
                      </div>
                    )}
                </div>
                <p className="mt-1.5 text-xs text-text-faint">
                  追加到系统提示末尾，底层存储与发送的是原始 markdown 源。JSON 输出协议和锚点规则已锁定，无法被覆盖。
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
                  disabled={dataActionsLocked}
                  title={dataActionsLocked ? "请求处理中，请等待完成" : undefined}
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
                  disabled={dataActionsLocked}
                  title={dataActionsLocked ? "请求处理中，请等待完成" : undefined}
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
