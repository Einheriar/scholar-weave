import { isTauri, tauriProxyOptions } from "@/lib/platform";
import type { ProxyAgent } from "undici";
import type { ProxyConfig } from "./provider";

const NETWORK_ERROR_DETAILS: Record<string, string> = {
  UND_ERR_CONNECT_TIMEOUT: "连接超时，请检查模型服务地址和代理。",
  UND_ERR_HEADERS_TIMEOUT: "等待模型服务响应超时。",
  UND_ERR_BODY_TIMEOUT: "读取模型服务响应超时。",
  UND_ERR_SOCKET: "连接被中断，请检查模型服务或代理是否断开了请求。",
  ECONNRESET: "连接被重置，请检查模型服务或代理是否断开了请求。",
  ECONNREFUSED: "连接被拒绝，请检查模型服务或代理是否正在运行。",
  ETIMEDOUT: "网络连接超时，请检查网络和代理。",
  ENOTFOUND: "无法解析模型服务地址，请检查地址和 DNS。",
  EAI_AGAIN: "域名解析暂时失败，请稍后重试。",
  CERT_HAS_EXPIRED: "服务证书已过期，请检查服务地址和系统时间。",
  DEPTH_ZERO_SELF_SIGNED_CERT: "服务证书不受信任，请检查模型服务或代理的证书配置。",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "无法验证服务证书，请检查模型服务或代理的证书配置。",
};

function networkErrorDetail(error: unknown, depth = 0): string | undefined {
  if (!error || typeof error !== "object" || depth > 4) return undefined;
  const details = error as { code?: unknown; cause?: unknown; errors?: unknown[] };
  if (typeof details.code === "string" && Object.hasOwn(NETWORK_ERROR_DETAILS, details.code)) {
    return `${NETWORK_ERROR_DETAILS[details.code]}（${details.code}）`;
  }
  const causeDetail = networkErrorDetail(details.cause, depth + 1);
  if (causeDetail) return causeDetail;
  if (Array.isArray(details.errors)) {
    for (const nested of details.errors) {
      const detail = networkErrorDetail(nested, depth + 1);
      if (detail) return detail;
    }
  }
  return undefined;
}

/** Shared transport only; protocol adapters own their request and response shapes. */
export async function postProviderJSON(
  url: string,
  body: Record<string, unknown>,
  options: {
    headers: Record<string, string>;
    signal?: AbortSignal;
    proxy?: ProxyConfig;
    dispatcher?: ProxyAgent | null;
  },
): Promise<unknown> {
  let res: Response;
  try {
    const init = {
      method: "POST",
      headers: options.headers,
      body: JSON.stringify(body),
      signal: options.signal,
    };
    if (isTauri()) {
      const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
      const proxy = await tauriProxyOptions(options.proxy);
      res = await tauriFetch(url, {
        ...init,
        ...(proxy ? { proxy } : {}),
      } as RequestInit);
    } else {
      const fetchOpts: RequestInit & { dispatcher?: ProxyAgent } = init;
      if (options.dispatcher) fetchOpts.dispatcher = options.dispatcher;
      res = await fetch(url, fetchOpts);
    }
  } catch (err) {
    if (err && typeof err === "object" && "name" in err && err.name === "AbortError") throw err;
    throw new Error(
      `无法连接 LLM 服务：${networkErrorDetail(err) ?? (err instanceof Error ? err.message : String(err))}`,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `LLM 服务返回错误（HTTP ${res.status}）${text ? `：${text.slice(0, 200)}` : ""}`,
    );
  }
  const rawText = await res.text();
  try {
    return JSON.parse(rawText);
  } catch {
    throw new Error(`LLM 返回了非 JSON 响应（HTTP ${res.status}）：${rawText.slice(0, 200)}`);
  }
}
