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

export type ProxyType = "http" | "socks5";

export type ProxyConfig = {
  enabled: boolean;
  type: ProxyType;
  host: string;
  port: number;
};

export type LLMPreset = {
  id: string;
  /** 用户自定义名称，例如 "DeepSeek 主力号" */
  name: string;
  apiKey: string;
  baseURL: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  /** 是否允许在该预设下向模型发送图片；旧设置缺省为 true 以保持图片聊天可用。 */
  imageInputEnabled: boolean;
  /** 该预设专用的代理设置；enabled=false 时直连 */
  proxy: ProxyConfig;
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
  imageInputEnabled: true,
  proxy: { enabled: false, type: "http", host: "127.0.0.1", port: 7890 },
};

/** 给每个调用方一份独立的默认 proxy 结构 */
function defaultProxy(): ProxyConfig {
  return { ...DEFAULT_PRESET.proxy };
}

/** 给每个调用方一份独立的默认 llm 结构，避免共享 presets 数组被就地改写 */
function defaultLlm(): UserSettings["llm"] {
  return { activeId: DEFAULT_PRESET.id, presets: [{ ...DEFAULT_PRESET }] };
}

/**
 * 默认的软提示词（写作原则 + 风格约束），原样摘自用户提供的学术写作指令。
 * 硬提示词（JSON 协议、锚点规则、模式说明）由系统提示词锁定，不在这里。
 */
export const DEFAULT_CUSTOM_PROMPT = `## Core Writing Principles (Mandatory)

- **Concise & Elegant**: Eliminate redundancy and vague logic. Every sentence should be lean and purposeful.
- **Academic Rigor**: Use formal, professional terminology with precise grammatical structures.
- **Logical Coherence**: Ensure seamless transitions between sentences and paragraphs, maintaining a rigorous deductive order.
- **Fluency**: Optimize sentence rhythm and variety. Avoid repetitive vocabulary and loose structures.
- **Sentence Rhythm**: Favor moderately long sentences for establishing context or articulating complex mechanisms, followed by shorter sentences for emphasis or summary. The contrast in length creates momentum; do not flatten the rhythm into uniform sentence lengths.
- **One Focus Per Sentence**: Each sentence should carry a single clear informational focus. Do not stack multiple layers of information (e.g., instrument, brain region, task, and outcome variable) into one sentence. Distribute information across sentences in a logical progression.
- **Declarative vs. Argumentative Paragraphs**: Distinguish clearly between paragraphs that *argue* and paragraphs that *announce*. In particular, a "Current Study" paragraph at the end of an Introduction should declare the study design and hypotheses concisely, not re-argue the rationale already established in preceding paragraphs. A single clause of recapitulation is sufficient (e.g., "Given their consistent involvement in X and established relevance to Y, ...").
- **Dialectical Structure in Discussion**: When engaging with competing findings or alternative explanations, follow a three-move pattern: (1) acknowledge the validity of the opposing view, (2) introduce a counterpoint or complication via contrast, (3) derive a new theoretical insight. This applies at both the paragraph and multi-paragraph level.

## Style Constraints (User's DNA) - ALWAYS ACTIVE

- **Vocabulary Tone:**
  - Prefer formal causal and contrastive connectors (e.g., "Hence", "Thus", "However", "Specifically", "In particular") over colloquial alternatives (e.g., "So", "But", "Also").
  - This is a *tonal preference*, not a fixed lexicon. Vary connector choice naturally to avoid monotony; the guiding principle is formality over casualness.
  - **Core verbs:** "Investigate", "Demonstrate", "Dissociate", "Question", "Argue", "Complement". Use these and their synonyms where contextually appropriate.
  - **AVOID:** "Growing research...", "Looking into...".
  - **Rule:** Use "for example" instead of "for instance".
- **Nominalization:**
  - Prefer compressed noun phrases over full clauses when describing processes or mechanisms (e.g., "the recruitment of cognitive control mechanisms" rather than "how the brain recruits cognitive control mechanisms"). This increases information density and maintains a formal register.
- **Voice:**
  - In Methods, default to passive voice for procedural descriptions, but do not avoid active voice when it improves clarity (e.g., "We recruited..." is acceptable).
  - In Results, let the data act as subject when possible (e.g., "Results indicate...", "Clustering analyses revealed...").
  - In Introduction and Discussion, choose voice freely based on what best serves the sentence's communicative goal.
- **Lexical & Phrasing Preferences (Vocabulary Filter):**
  - Use "neural activity" INSTEAD OF "cortical activity".
- **ATTENTION:**
  - **NEVER** use em-dashes (—) or dash-enclosed clauses. Use commas, parentheses, or separate sentences instead.`;

export const DEFAULT_SETTINGS: UserSettings = {
  llm: defaultLlm(),
  review: {
    customPrompt: DEFAULT_CUSTOM_PROMPT,
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
    imageInputEnabled: true,
    proxy: defaultProxy(),
  };
}

/** 归一化一条（可能来自旧数据/手改 localStorage 的）预设 */
function normalizePreset(raw: Partial<LLMPreset>, fallbackId: string): LLMPreset {
  const rawProxy = (raw as { proxy?: Partial<ProxyConfig> }).proxy;
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
    // Missing capability metadata means an older saved preset. Preserve the
    // existing image-chat behavior until the user explicitly turns it off.
    imageInputEnabled: raw.imageInputEnabled !== false,
    proxy: {
      enabled: rawProxy?.enabled === true,
      type: rawProxy?.type === "socks5" ? "socks5" : "http",
      host: typeof rawProxy?.host === "string" && rawProxy.host ? rawProxy.host : "127.0.0.1",
      port:
        typeof rawProxy?.port === "number" && rawProxy.port > 0 && rawProxy.port < 65536
          ? rawProxy.port
          : 7890,
    },
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
    const review = { ...DEFAULT_SETTINGS.review, ...parsed.review };
    // 迁移：旧数据 customPrompt 为空时填入默认软提示词
    if (!review.customPrompt) review.customPrompt = DEFAULT_CUSTOM_PROMPT;
    return {
      llm: migrateLlm(parsed.llm),
      review,
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
          proxy: preset.proxy.enabled
            ? {
                type: preset.proxy.type,
                host: preset.proxy.host,
                port: preset.proxy.port,
              }
            : undefined,
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
