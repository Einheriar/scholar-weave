import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  // 版本号唯一来源是 package.json，构建时内联给前端（页脚展示 v0.1.0 形式）。
  // 用 NEXT_PUBLIC_ 前缀是因为它要出现在浏览器端；版本号不是敏感信息。
  env: {
    NEXT_PUBLIC_APP_VERSION: `v${pkg.version}`,
  },
  // 仅当显式要求打包时（npm run package:app）才产出自包含的 .next/standalone。
  // 注意：开启 standalone 后 `next start` 会失效并报警告，所以默认不启用，
  // 保证 npm run dev / npm start 的日常用法不受影响。
  ...(process.env.NEXT_OUTPUT_STANDALONE === "1"
    ? { output: "standalone" as const }
    : {}),
  // 关掉 Next 的开发指示器（默认在左下角的小圆标，只在开发模式出现，生产构建里本来就没有）。
  // 实测四个角都会被界面挡住：左下撞页脚文字与自绘浮动按钮、左上撞文档标题（≤1316px）、
  // 右上撞「N 条待处理」徽标（900–1316px）、右下撞右对齐的版本号/revision 行。
  // 它只是个开发辅助，留着却看起来像布局 bug，故默认关闭。
  // 编译/运行错误仍会照常弹出覆盖层。想恢复就把这行改成
  // `devIndicators: { position: "top-right" }`（或删掉本行用默认左下角）。
  // 另外开发时也可以点开指示器选「Hide Dev Tools for this session」临时隐藏，不必改配置。
  devIndicators: false,
  // 允许 127.0.0.1 访问开发资源（HMR），便于本地无头浏览器验证
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
