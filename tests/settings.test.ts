import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_SETTINGS,
  STORAGE_KEY_FOR_TEST,
  getActivePreset,
  loadSettings,
  saveSettings,
  settingsToRequestBody,
} from "@/lib/settings";

/**
 * settings.ts 的迁移是这次改动的核心风险点：
 * 旧用户 localStorage 里已有扁平格式的配置，升级后不能丢。
 */

beforeEach(() => {
  localStorage.clear();
});

describe("loadSettings 迁移", () => {
  it("空存储返回默认设置", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("v1 扁平格式迁移为单条预设，保留原有值", () => {
    localStorage.setItem(
      STORAGE_KEY_FOR_TEST,
      JSON.stringify({
        llm: {
          apiKey: "sk-legacy",
          baseURL: "https://api.openrouter.ai",
          model: "some-model",
          reasoningEffort: "medium", // 旧档位，新枚举里不存在
        },
        review: { style: "学术" },
      }),
    );
    const s = loadSettings();
    expect(s.llm.presets).toHaveLength(1);
    const preset = getActivePreset(s);
    expect(preset.apiKey).toBe("sk-legacy");
    expect(preset.baseURL).toBe("https://api.openrouter.ai");
    expect(preset.model).toBe("some-model");
    // 旧档位非法 → 落到 auto
    expect(preset.reasoningEffort).toBe("auto");
    expect(s.review.style).toBe("学术");
  });

  it("新格式原样加载，activeId 非法时兜底第一条", () => {
    localStorage.setItem(
      STORAGE_KEY_FOR_TEST,
      JSON.stringify({
        llm: {
          activeId: "nonexistent",
          presets: [
            {
              id: "a",
              name: "配置A",
              apiKey: "k1",
              baseURL: "https://x.com",
              model: "m1",
              reasoningEffort: "high",
            },
            {
              id: "b",
              name: "配置B",
              apiKey: "k2",
              baseURL: "https://y.com",
              model: "m2",
              reasoningEffort: "off",
            },
          ],
        },
      }),
    );
    const s = loadSettings();
    expect(s.llm.presets).toHaveLength(2);
    expect(s.llm.activeId).toBe("a");
    expect(getActivePreset(s).apiKey).toBe("k1");
  });

  it("损坏的 JSON 返回默认设置", () => {
    localStorage.setItem(STORAGE_KEY_FOR_TEST, "{not-json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("settingsToRequestBody", () => {
  it("active 预设无 apiKey 时 llmConfig 为 undefined", () => {
    const body = settingsToRequestBody(DEFAULT_SETTINGS);
    expect(body.llmConfig).toBeUndefined();
  });

  it("active 预设的档位随请求体发出", () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    s.llm.presets[0].apiKey = "sk-test";
    s.llm.presets[0].reasoningEffort = "max";
    const body = settingsToRequestBody(s);
    expect(body.llmConfig?.reasoningEffort).toBe("max");
  });

  it("非 active 预设的值不会发出", () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    s.llm.presets.push({
      id: "other",
      name: "别的",
      apiKey: "sk-other",
      baseURL: "https://other.com",
      model: "other-model",
      reasoningEffort: "low",
    });
    s.llm.presets[0].apiKey = "sk-main";
    const body = settingsToRequestBody(s);
    expect(body.llmConfig?.apiKey).toBe("sk-main");
  });
});

describe("saveSettings 往返", () => {
  it("保存后能原样读回", () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    s.llm.presets.push({
      id: "p2",
      name: "OpenRouter 备用",
      apiKey: "sk-or",
      baseURL: "https://openrouter.ai/api",
      model: "anthropic/claude",
      reasoningEffort: "off",
    });
    s.llm.activeId = "p2";
    saveSettings(s);
    const loaded = loadSettings();
    expect(loaded).toEqual(s);
  });
});
