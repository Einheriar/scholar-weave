import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import pkg from "./package.json" with { type: "json" };

// Tauri 期望固定端口；占用时直接失败而不是静默换一个
export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), tsconfigPaths()],
    clearScreen: false,
    server: {
      port: 5173,
      strictPort: true,
      host: process.env.TAURI_DEV_HOST || false,
      hmr: process.env.TAURI_DEV_HOST
        ? { protocol: "ws", host: process.env.TAURI_DEV_HOST, port: 1421 }
        : undefined,
      watch: { ignored: ["**/src-tauri/**"] },
    },
    envPrefix: ["VITE_", "TAURI_ENV_*"],
    define: {
      // 与 next.config.ts 的 NEXT_PUBLIC_APP_VERSION 对齐，保持版本号唯一来源是 package.json
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(`v${pkg.version}`),
    },
    build: {
      // Windows 上 Tauri 用 WebView2（Chromium 内核）；纯浏览器构建也面向现代 Chrome/Edge
      target:
        process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "es2020",
      minify: !process.env.TAURI_ENV_DEBUG,
      sourcemap: !!process.env.TAURI_ENV_DEBUG,
    },
  };
});
