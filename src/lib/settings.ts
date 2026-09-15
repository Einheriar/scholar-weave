/**
 * 用户设置：LLM 连接配置 + 审阅偏好。
 * 全部持久化在 localStorage，服务端通过请求体接收（密钥不会落到服务端 env）。
 *
 * LLM 配置按「预设」组织：每个预设是一条 apiKey + baseURL + model + 思考档位，
 * 用户可自由命名、增删，activeId 指向当前生效的预设。切换预设不会丢配置。
 */

/**
 * 思考档位（四档抽象，对齐 low/high/max 作为行业最大公约数）。
 * - "auto"：不传 thinking 参数，交给模型自己决定
 * - "off"：显式关闭思考；DeepSeek 风格端点会收到 enable_thinking=false，
 *   不支持的提供商会直接报错（比静默忽略好）
 *
 * 档位到请求参数的映射在 src/lib/llm/thinking.ts（服务端与前端共用）。
 */
export type ReasoningEffort = "auto" | "off" | "low" | "high" | "max";

export const REASONING_EFFORT_OPTIONS: Array<{
  value: ReasoningEffort;
  label: string;
  description: string;
}> = [
  { value: "auto", label: "默认", description: "交给模型决定" },
  { value: "off", label: "不思考", description: "最快，可能降低质量" },
  { value: "low", label: "Low", description: "轻度思考" },
  { value: "high", label: "High", description: "深度分析" },
  { value: "max", label: "Max", description: "最大思考量" },
];

export type LLMPreset = {
  id: string;
  /** 用户自定义名称，例如 "DeepSeek 主力号" */
  name: string;
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
  llm: {
    activeId: string;
    presets: LLMPreset[];
  };
  review: ReviewPreferences;
};

const STORAGE_KEY = "supergrammarly-settings";

/** 仅供测试引用，业务代码不要 import 这个 */
export const STORAGE_KEY_FOR_TEST = STORAGE_KEY;

const DEFAULT_PRESET: LLMPreset = {
  id: "default",
  name: "默认配置",
  apiKey: "",
  baseURL: "https://api.deepseek.com",
  model: "deepseek-chat",
  reasoningEffort: "auto",
};

/** 给每个调用方一份独立的默认 llm 结构，避免共享 presets 数组被就地改写 */
function defaultLlm(): UserSettings["llm"] {
  return { activeId: DEFAULT_PRESET.id, presets: [{ ...DEFAULT_PRESET }] };
}

export const DEFAULT_SETTINGS: UserSettings = {
  llm: defaultLlm(),
  review: {
    customPrompt: "",
    style: "保持原文风格",
    preserveTerms: "",
  },
};

/** 当前生效的预设；找不到时兜底第一条（保证永不返回 undefined） */
export function getActivePreset(settings: UserSettings): LLMPreset {
  return (
    settings.llm.presets.find((p) => p.id === settings.llm.activeId) ??
    settings.llm.presets[0] ??
    DEFAULT_PRESET
  );
}

export function createPreset(name?: string): LLMPreset {
  return {
    id:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name?.trim() || "新配置",
    apiKey: "",
    baseURL: "https://api.deepseek.com",
    model: "deepseek-chat",
    reasoningEffort: "auto",
  };
}

/** 归一化一条（可能来自旧数据/手改 localStorage 的）预设 */
function normalizePreset(raw: Partial<LLMPreset>, fallbackId: string): LLMPreset {
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : fallbackId,
    name: typeof raw.name === "string" && raw.name ? raw.name : "配置",
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "",
    baseURL:
      typeof raw.baseURL === "string" && raw.baseURL
        ? raw.baseURL
        : DEFAULT_PRESET.baseURL,
    model:
      typeof raw.model === "string" && raw.model
        ? raw.model
        : DEFAULT_PRESET.model,
    reasoningEffort: REASONING_EFFORT_OPTIONS.some((o) => o.value === raw.reasoningEffort)
      ? (raw.reasoningEffort as ReasoningEffort)
      : "auto",
  };
}

/**
 * 兼容旧格式：v1 的 llm 是扁平的 { apiKey, baseURL, model, reasoningEffort }，
 * 迁移为单条预设并保留原值（旧的 7 档 effort 全部落到 auto）。
 */
function migrateLlm(raw: unknown): UserSettings["llm"] {
  if (!raw || typeof raw !== "object") return defaultLlm();
  const llm = raw as Record<string, unknown>;

  if (Array.isArray(llm.presets)) {
    const presets = (llm.presets as Array<Partial<LLMPreset>>)
      .filter((p) => p && typeof p === "object")
      .map((p, i) => normalizePreset(p, `preset-${i}`));
    if (presets.length > 0) {
      const activeId =
        typeof llm.activeId === "string" &&
        presets.some((p) => p.id === llm.activeId)
          ? (llm.activeId as string)
          : presets[0].id;
      return { activeId, presets };
    }
  }

  // v1 扁平格式：包成一条预设
  const legacy = llm as Partial<{
    apiKey: string;
    baseURL: string;
    model: string;
    reasoningEffort: string;
  }>;
  const hasLegacyContent = Boolean(
    legacy.apiKey ||
      (legacy.baseURL && legacy.baseURL !== DEFAULT_PRESET.baseURL) ||
      (legacy.model && legacy.model !== DEFAULT_PRESET.model),
  );
  if (!hasLegacyContent) return defaultLlm();
  const preset = normalizePreset(
    {
      id: "default",
      name: "默认配置",
      apiKey: legacy.apiKey,
      baseURL: legacy.baseURL,
      model: legacy.model,
    },
    "default",
  );
  return { activeId: preset.id, presets: [preset] };
}

const freshDefaults = (): UserSettings => ({
  llm: defaultLlm(),
  review: { ...DEFAULT_SETTINGS.review },
});

export function loadSettings(): UserSettings {
  if (typeof window === "undefined") return freshDefaults();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshDefaults();
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return {
      llm: migrateLlm(parsed.llm),
      review: { ...DEFAULT_SETTINGS.review, ...parsed.review },
    };
  } catch {
    return freshDefaults();
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
  const preset = getActivePreset(settings);
  return {
    llmConfig: preset.apiKey
      ? {
          apiKey: preset.apiKey,
          baseURL: preset.baseURL || undefined,
          model: preset.model || undefined,
          reasoningEffort: preset.reasoningEffort,
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
