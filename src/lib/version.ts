/**
 * 应用版本号（形如 `v0.1.0`），页脚展示。
 *
 * 值由 next.config.ts 在构建时从 package.json 读取并内联，避免版本号在两处各写一遍。
 * 必须直接引用 `process.env.NEXT_PUBLIC_APP_VERSION`：写成解构或变量取值不会被内联，
 * 浏览器端会拿到 undefined（Next 的 DefinePlugin 替换的是字面量）。
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "v0.0.0";
