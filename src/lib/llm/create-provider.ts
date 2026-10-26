import { GeminiProvider } from "./gemini-provider";
import { OpenAIProvider } from "./openai-provider";
import type { GenerateOptions, LLMProvider, ProviderConfig } from "./provider";
import type { ProxyAgent } from "undici";

export function isGeminiModel(model?: string): boolean {
  return /gemini/i.test(model ?? "");
}

/** Client-safe selection shared by the Node factory and Tauri. */
export function createProvider(config: ProviderConfig, dispatcher: ProxyAgent | null = null): LLMProvider {
  return isGeminiModel(config.model)
    ? new GeminiProvider(config, dispatcher)
    : new OpenAIProvider(config, dispatcher);
}

/** Thinking models need enough room for both reasoning and the short probe answer. */
export function connectionTestOptions(model?: string): GenerateOptions {
  return isGeminiModel(model)
    ? { maxTokens: 4096, reasoningEffort: "low" }
    : { maxTokens: 64, reasoningEffort: "off" };
}
