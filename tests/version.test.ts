import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import pkg from "../package.json";

/**
 * 页脚展示的版本号由 next.config.ts 在构建时从 package.json 注入。
 * 这里守住「唯一来源」这条线：改了 package.json 的 version，页脚必须跟着变，
 * 不允许在别处硬编码一份。
 */
describe("应用版本号", () => {
  const injected = (nextConfig.env as Record<string, string> | undefined)
    ?.NEXT_PUBLIC_APP_VERSION;

  it("注入值取自 package.json", () => {
    expect(injected).toBe(`v${pkg.version}`);
  });

  it("是标准的 v<major>.<minor>.<patch> 形式", () => {
    expect(injected).toMatch(/^v\d+\.\d+\.\d+$/);
  });
});
