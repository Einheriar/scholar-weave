import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 仅当显式要求打包时（npm run package:app）才产出自包含的 .next/standalone。
  // 注意：开启 standalone 后 `next start` 会失效并报警告，所以默认不启用，
  // 保证 npm run dev / npm start 的日常用法不受影响。
  ...(process.env.NEXT_OUTPUT_STANDALONE === "1"
    ? { output: "standalone" as const }
    : {}),
  // 允许 127.0.0.1 访问开发资源（HMR），便于本地无头浏览器验证
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
