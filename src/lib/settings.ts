/**
 * 用户设置：LLM 连接配置 + 审阅偏好。
 * 全部持久化在 localStorage，服务端通过请求体接收（密钥不会落到服务端 env）。
 */

export type ReasoningEffort =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultra";

export const REASONING_EFFORT_OPTIONS: Array<{
  value: ReasoningEffort;
  label: string;
  description: string;
}> = [
  { value: "minimal", label: "Minimal", description: "最快，最少思考" },
  { value: "low", label: "Low", description: "快速响应" },
  { value: "medium", label: "Medium", description: "平衡" },
  { value: "high", label: "High", description: "深度分析" },
  { value: "xhigh", label: "XHigh", description: "更深度" },
  { value: "max", label: "Max", description: "最大思考量" },
  { value: "ultra", label: "Ultra", description: "超越最大（若支持）" },
];

export type LLMSettings = {
  apiKey: string;
  baseURL: string;
  model: string;
  reasoningEffort: ReasoningEffort;
};

export type ReviewPreferences = {
  /** 追加到系统提示末尾的用户自定义指令 */
  customPrompt: string;
  /** 写作风格描述 */
  style: string;
  /** 必须保留的术语（逗号分隔） */
  preserveTerms: string;
};

export type UserSettings = {
  llm: LLMSettings;
  review: ReviewPreferences;
};

const STORAGE_KEY = "supergrammarly-settings";

export const DEFAULT_SETTINGS: UserSettings = {
  llm: {
    apiKey: "",
    baseURL: "https://api.deepseek.com",
    model: "deepseek-chat",
    reasoningEffort: "medium",
  },
  review: {
    customPrompt: "",
    style: "保持原文风格",
    preserveTerms: "",
  },
};

export function loadSettings(): UserSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return {
      llm: { ...DEFAULT_SETTINGS.llm, ...parsed.llm },
      review: { ...DEFAULT_SETTINGS.review, ...parsed.review },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: UserSettings): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage unavailable
  }
}

/** 把设置转成请求体里带给服务端的字段 */
export function settingsToRequestBody(settings: UserSettings) {
  return {
    llmConfig: settings.llm.apiKey
      ? {
          apiKey: settings.llm.apiKey,
          baseURL: settings.llm.baseURL || undefined,
          model: settings.llm.model || undefined,
          reasoningEffort: settings.llm.reasoningEffort,
        }
      : undefined,
    reviewPrefs: {
      customPrompt: settings.review.customPrompt || undefined,
      style: settings.review.style || undefined,
      preserveTerms: settings.review.preserveTerms
        ? settings.review.preserveTerms
            .split(/[,，]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    },
  };
}
