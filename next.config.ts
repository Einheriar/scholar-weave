import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 允许 127.0.0.1 访问开发资源（HMR），便于本地无头浏览器验证
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
