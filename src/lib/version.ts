/**
 * 应用版本号（形如 `vX.Y.Z`），页脚展示。
 *
 * 双轨构建：
 * - Next.js 版：next.config.ts 构建时从 package.json 读取，内联为 NEXT_PUBLIC_APP_VERSION。
 *   必须直接引用 `process.env.NEXT_PUBLIC_APP_VERSION`：写成解构或变量取值不会被内联。
 * - Vite/Tauri 版：vite.config.ts 用 loadEnv 读 package.json，注入为 VITE_APP_VERSION。
 *   Vite 用 import.meta.env 取代 process.env，且不会自动注入 NODE_ENV 相关变量。
 */
const version =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_APP_VERSION
    : import.meta.env.VITE_APP_VERSION;

export const APP_VERSION = version ?? "v0.0.0";
