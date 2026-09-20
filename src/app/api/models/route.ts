import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildProxyDispatcher,
  normalizeProviderBaseURL,
} from "@/lib/llm/openai-provider";
import { normalizeModelIds } from "@/lib/llm/model-list";
import type { ProxyAgent } from "undici";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MODEL_LIST_TIMEOUT_MS = 10_000;

const ProxySchema = z
  .object({
    type: z.enum(["http", "socks5"]),
    host: z.string().trim().min(1).max(253),
    port: z.number().int().positive().lt(65_536),
  })
  .strict();

const RequestSchema = z
  .object({
    apiKey: z.string().max(2_000),
    baseURL: z.string().trim().min(1).max(2_048),
    proxy: ProxySchema.optional(),
  })
  .strict();

type ModelListRequest = z.infer<typeof RequestSchema>;
type ErrorBody = { error: { code: string; message: string } };

function err(status: number, code: string, message: string) {
  return NextResponse.json<ErrorBody>(
    { error: { code, message } },
    { status },
  );
}

function isValidBaseURL(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.search.length === 0 &&
      url.hash.length === 0
    );
  } catch {
    return false;
  }
}

function isValidProxyHost(value: string): boolean {
  return !/[\s/?#]/.test(value);
}

class ModelListUpstreamError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("model_list_upstream_error");
    this.name = "ModelListUpstreamError";
    this.status = status;
  }
}

async function fetchModelIds(
  config: ModelListRequest,
  signal: AbortSignal,
): Promise<string[]> {
  const baseURL = normalizeProviderBaseURL(config.baseURL);
  const dispatcher = buildProxyDispatcher(config.proxy);
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  const fetchOptions: RequestInit & { dispatcher?: ProxyAgent } = {
    method: "GET",
    headers,
    cache: "no-store",
    signal,
  };
  if (dispatcher) fetchOptions.dispatcher = dispatcher;

  try {
    const response = await fetch(`${baseURL}/models`, fetchOptions);
    if (!response.ok) throw new ModelListUpstreamError(response.status);

    let payload: unknown;
    try {
      payload = JSON.parse(await response.text());
    } catch {
      throw new Error("invalid_model_list");
    }
    return normalizeModelIds(payload);
  } finally {
    // A one-shot route should not retain proxy sockets between requests.
    if (dispatcher) await dispatcher.close().catch(() => undefined);
  }
}

export async function POST(request: Request) {
  if (request.signal.aborted) {
    return err(499, "client_aborted", "请求已取消。");
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    if (request.signal.aborted) {
      return err(499, "client_aborted", "请求已取消。");
    }
    return err(400, "bad_json", "请求体不是合法 JSON。");
  }

  const parsed = RequestSchema.safeParse(raw);
  if (!parsed.success) {
    return err(400, "invalid_request", "模型列表请求参数不合法。");
  }
  if (request.signal.aborted) {
    return err(499, "client_aborted", "请求已取消。");
  }
  const config = parsed.data;
  if (!isValidBaseURL(config.baseURL)) {
    return err(400, "invalid_base_url", "模型服务地址不合法。");
  }
  if (config.proxy && !isValidProxyHost(config.proxy.host)) {
    return err(400, "invalid_proxy", "代理地址不合法。");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_LIST_TIMEOUT_MS);
  const onClientAbort = () => controller.abort();
  request.signal.addEventListener("abort", onClientAbort);

  try {
    const models = await fetchModelIds(config, controller.signal);
    return NextResponse.json(
      { models },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      return err(
        request.signal.aborted ? 499 : 504,
        request.signal.aborted ? "client_aborted" : "models_timeout",
        request.signal.aborted ? "请求已取消。" : "获取模型列表超时，请检查网络或代理设置。",
      );
    }
    if (error instanceof ModelListUpstreamError) {
      return err(502, "models_error", `模型服务返回错误（HTTP ${error.status}）。`);
    }
    return err(502, "models_invalid_response", "模型服务返回的数据无法识别。");
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", onClientAbort);
  }
}
