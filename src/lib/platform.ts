/**
 * 平台判断与平台相关的网络层适配。
 *
 * 双轨架构：
 * - Next.js 服务端路由（浏览器版）：直接用 Node 的 fetch + undici ProxyAgent
 * - Tauri 桌面版：用 @tauri-apps/plugin-http 的 fetch（Rust reqwest 发出，绕过 CORS）
 *
 * 这个文件是前端代码里唯一感知运行平台的地方，业务组件不直接依赖它。
 */

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

type ProxyConfig = { type: "http" | "socks5"; host: string; port: number };

/**
 * Tauri 的 plugin-http 原生支持代理（per-request proxy 参数，底层是 reqwest）。
 * 返回 plugin-http 的 proxy 选项；浏览器环境下返回 undefined（代理由服务端处理）。
 */
export async function tauriProxyOptions(proxy?: ProxyConfig) {
  if (!proxy) return undefined;
  const scheme = proxy.type === "socks5" ? "socks5" : "http";
  return { all: `${scheme}://${proxy.host}:${proxy.port}` };
}
