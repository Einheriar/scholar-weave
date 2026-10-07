import { ProxyAgent } from "undici";
import type { ProxyConfig } from "./provider";

/** Node-only proxy transport. Never import this module from the client graph. */
export function buildProxyDispatcher(proxy: ProxyConfig | undefined): ProxyAgent | null {
  if (!proxy) return null;
  const scheme = proxy.type === "socks5" ? "socks5://" : "http://";
  return new ProxyAgent(`${scheme}${proxy.host}:${proxy.port}`);
}
