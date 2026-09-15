import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getProviderFromEnv,
  getProviderFromUserConfig,
} from "@/lib/llm/provider";

/**
 * POST /api/test-connection。
 * 用极低的 maxTokens 发一个最小 chat 请求，只探测连通性，不取内容。
 * 用户配置（含代理）优先于 env；返回 { ok: true } 或统一错误结构。
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RequestSchema = z.object({
  llmConfig: z
    .object({
      apiKey: z.string().min(1),
      baseURL: z.string().optional(),
      model: z.string().optional(),
      reasoningEffort: z.string().optional(),
      proxy: z
        .object({
          type: z.enum(["http", "socks5"]),
          host: z.string().min(1),
          port: z.number().int().positive().lt(65536),
        })
        .optional(),
    })
    .optional(),
});

type ErrorBody = { error: { code: string; message: string } };

function err(status: number, code: string, message: string) {
  return NextResponse.json<ErrorBody>({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return err(400, "bad_json", "请求体不是合法 JSON。");
  }
  const parsed = RequestSchema.safeParse(raw);
  if (!parsed.success) {
    return err(
      400,
      "invalid_request",
      `请求参数不合法：${parsed.error.issues[0]?.message ?? "未知错误"}`,
    );
  }

  const { llmConfig } = parsed.data;

  let provider;
  try {
    provider = llmConfig?.apiKey
      ? getProviderFromUserConfig(llmConfig)
      : getProviderFromEnv();
  } catch (e) {
    return err(
      500,
      "provider_misconfigured",
      e instanceof Error ? e.message : "LLM 服务未配置。",
    );
  }

  // 10 秒超时——测试连接不需要等太久
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    await provider.generate(
      [{ role: "user", content: "hi" }],
      { maxTokens: 64, signal: controller.signal, reasoningEffort: "off" },
    );
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return err(504, "llm_timeout", "连接超时，请检查网络或代理设置。");
    }
    return err(
      502,
      "llm_error",
      e instanceof Error ? e.message : "连接失败。",
    );
  } finally {
    clearTimeout(timer);
  }

  return NextResponse.json({ ok: true });
}
