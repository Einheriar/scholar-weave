import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright 端到端配置（阶段 6）。
 *
 * 本机没有 Playwright 自带 chromium 构建所需的系统依赖，所以用系统安装的
 * Google Chrome（channel: "chrome"）而不是下载的 chromium。
 *
 * 用 `localhost`（而非 127.0.0.1）访问，与 next.config.ts 的 allowedDevOrigins 一致，
 * 避免 HMR 跨域被拦。
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // 供“复制全文”用例读取剪贴板
    permissions: ["clipboard-read", "clipboard-write"],
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
