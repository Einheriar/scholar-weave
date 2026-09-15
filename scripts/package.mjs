import { spawnSync } from "node:child_process";
import { chmod, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * 把项目打包成一个自包含的本地应用目录（dist/），用于双击启动。
 *
 * 产物结构：
 *   dist/
 *     app/            Next.js standalone 服务（自带 node_modules，只需要系统有 Node）
 *       server.js
 *       .next/static  静态资源
 *       public/
 *     start.mjs       跨平台启动器（起服务 + 打开浏览器）
 *     start.cmd       Windows 双击入口
 *     start.sh        Linux/macOS 双击入口
 *
 * 注意：产物含平台专属的原生依赖（sharp），**必须在目标操作系统上打包**。
 * Linux 上打的包不能直接拷到 Windows 运行。
 */

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const appDir = path.join(dist, "app");

/** 跨平台启动器：起 Next 服务并打开浏览器 */
const LAUNCHER = `import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "app");
const port = process.env.PORT || "3000";
const url = \`http://localhost:\${port}\`;

if (!existsSync(join(appDir, ".env.local"))) {
  console.warn(
    "⚠ 未找到 app/.env.local，LLM 相关功能会失败。请照 .env.local.example 创建。",
  );
}

const server = spawn(process.execPath, ["server.js"], {
  cwd: appDir,
  stdio: "inherit",
  env: { ...process.env, PORT: port, HOSTNAME: "127.0.0.1" },
});

server.on("exit", (code) => process.exit(code ?? 0));

setTimeout(() => {
  const cmd =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  spawn(cmd[0], cmd[1], { stdio: "ignore", detached: true }).unref();
  console.log(\`\\n已在浏览器打开 \${url}（关闭本窗口即停止服务）\\n\`);
}, 1500);
`;

function log(msg) {
  process.stdout.write(`\n▶ ${msg}\n`);
}

log("清理旧的 dist/");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

log("构建生产版本（standalone）");
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const build = spawnSync(process.execPath, [nextBin, "build"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, NEXT_OUTPUT_STANDALONE: "1" },
});
if (build.status !== 0) {
  console.error("\n构建失败，已中止打包。");
  process.exit(build.status ?? 1);
}

const standalone = path.join(root, ".next", "standalone");
if (!existsSync(path.join(standalone, "server.js"))) {
  console.error(
    "\n没有找到 .next/standalone/server.js——请确认 next.config.ts 的 NEXT_OUTPUT_STANDALONE 分支未被改动。",
  );
  process.exit(1);
}

log("组装 dist/app");
await cp(standalone, appDir, { recursive: true });
// standalone 默认不复制这两处，需要手动补上（否则页面没有样式与静态资源）
await cp(path.join(root, "public"), path.join(appDir, "public"), {
  recursive: true,
});
await cp(
  path.join(root, ".next", "static"),
  path.join(appDir, ".next", "static"),
  { recursive: true },
);

log("写入启动器");
await writeFile(path.join(dist, "start.mjs"), LAUNCHER, "utf8");

const cmdShim = [
  "@echo off",
  "rem Windows 双击入口：启动服务并打开浏览器",
  'node "%~dp0start.mjs"',
  "pause",
  "",
].join("\r\n");
await writeFile(path.join(dist, "start.cmd"), cmdShim, "utf8");

const shShim = [
  "#!/bin/sh",
  "# Linux/macOS 双击入口：启动服务并打开浏览器",
  'exec node "$(dirname "$0")/start.mjs"',
  "",
].join("\n");
await writeFile(path.join(dist, "start.sh"), shShim, "utf8");
await chmod(path.join(dist, "start.sh"), 0o755);

// 有真实配置就带上（本地使用方便）；否则放一份模板
const envLocal = path.join(root, ".env.local");
if (existsSync(envLocal)) {
  await cp(envLocal, path.join(appDir, ".env.local"));
  log("已复制 .env.local（含密钥，勿外传）");
} else {
  await cp(
    path.join(root, ".env.example"),
    path.join(appDir, ".env.local.example"),
  );
  log(
    "未找到 .env.local，已放入 .env.local.example，首次运行前请照它创建 .env.local",
  );
}

const size = spawnSync("du", ["-sh", dist], { encoding: "utf8" });
log("完成");
process.stdout.write(
  [
    `产物目录：${dist}`,
    size.stdout ? `体积：${size.stdout.trim()}` : "",
    "",
    "启动方式：",
    "  Windows      双击 dist\\start.cmd（或在该目录执行 node start.mjs）",
    "  Linux/macOS  ./dist/start.sh（或 node dist/start.mjs）",
    "",
    "密钥配置：把 .env.local 放在 dist/app 目录下。",
    "",
  ]
    .filter(Boolean)
    .join("\n"),
);
