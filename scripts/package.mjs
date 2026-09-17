import { spawnSync } from "node:child_process";
import { chmod, cp, mkdir, rm, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
 * 对外分发时使用 `npm run package:app -- --without-env`，避免复制本机密钥。
 */

// 用 fileURLToPath 而不是 import.meta.dirname：后者要 Node 20.11+，
// 而 Next 只要求 20.9，这个脚本是要在用户机器上跑的。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const appDir = path.join(dist, "app");
const withoutEnv = process.argv.includes("--without-env");

/** 跨平台启动器：起 Next 服务并打开浏览器 */
const LAUNCHER = `import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Next 16 要求 Node >= 20.9；低于此版本 server.js 会以难以理解的方式报错，
// 这里提前给出明确提示。
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 20 || (major === 20 && minor < 9)) {
  console.error(
    \`\\n✖ 需要 Node.js 20.9 或更高版本，当前是 \${process.versions.node}。\\n\` +
      "  请到 https://nodejs.org/ 安装 LTS 版本后重试。\\n",
  );
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "app");
const port = Number(process.env.PORT || 3000);
const url = \`http://localhost:\${port}\`;

if (!existsSync(join(appDir, ".env.local"))) {
  console.warn(
    "⚠ 未找到 app/.env.local，LLM 相关功能会失败。请照 .env.local.example 创建。",
  );
}

// 端口被占用时 server.js 的报错容易被窗口一闪而过，双击看起来就像"没反应"。
// 先自己探测一次，给出可操作的提示。
const free = await new Promise((resolve) => {
  const tester = net.createServer();
  tester.once("error", () => resolve(false));
  tester.once("listening", () => tester.close(() => resolve(true)));
  tester.listen(port, "127.0.0.1");
});
if (!free) {
  console.error(
    \`\\n✖ 端口 \${port} 已被占用（可能服务已经在运行，或其它程序占用了它）。\\n\\n\` +
      "  换个端口再启动：\\n" +
      (process.platform === "win32"
        ? \`    set PORT=3200 && node start.mjs\\n\`
        : \`    PORT=3200 node start.mjs\\n\`) +
      \`  然后访问 http://localhost:3200\\n\`,
  );
  process.exit(1);
}

// 只绑定回环地址：既够本地使用，也能避免 Windows 弹出防火墙授权对话框
const server = spawn(process.execPath, ["server.js"], {
  cwd: appDir,
  stdio: "inherit",
  env: { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1" },
});

server.on("exit", (code) => process.exit(code ?? 0));

setTimeout(() => {
  const cmd =
    process.platform === "win32"
      ? // 用 cmd.exe 全名，避免个别环境下 PATH 解析不到
        ["cmd.exe", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  // 注意：命令不存在时 spawn 抛的是**异步** error 事件，try/catch 抓不到；
  // 不挂监听会让未捕获异常直接杀掉启动器、连服务一起带走。
  let failed = false;
  const child = spawn(cmd[0], cmd[1], { stdio: "ignore", detached: true });
  child.on("error", () => {
    failed = true;
  });
  child.unref();
  setTimeout(() => {
    if (failed) {
      console.log(\`（未能自动打开浏览器，请手动访问 \${url}）\`);
    }
  }, 300);
  console.log(\`\\n服务已启动：\${url}（关闭本窗口即停止）\\n\`);
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
  "rem 切到 UTF-8，否则中文提示在默认代码页下会乱码",
  "chcp 65001 >nul",
  "where node >nul 2>nul",
  "if errorlevel 1 (",
  "  echo.",
  "  echo [错误] 没有找到 Node.js。",
  "  echo 请先到 https://nodejs.org/ 安装 Node.js 20.9 或更高版本。",
  "  echo.",
  "  pause",
  "  exit /b 1",
  ")",
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
if (!withoutEnv && existsSync(envLocal)) {
  await cp(envLocal, path.join(appDir, ".env.local"));
  log("已复制 .env.local（含密钥，勿外传）");
} else {
  await cp(
    path.join(root, ".env.example"),
    path.join(appDir, ".env.local.example"),
  );
  log(
    withoutEnv
      ? "已按 --without-env 排除 .env.local，并放入配置模板"
      : "未找到 .env.local，已放入 .env.local.example，首次运行前请照它创建 .env.local",
  );
}

/** 递归计算目录体积（不依赖 du，Windows 上也能用） */
async function dirSize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else if (entry.isFile()) total += (await stat(full)).size;
  }
  return total;
}

const bytes = await dirSize(dist);
const mb = (bytes / 1024 / 1024).toFixed(0);
log("完成");
process.stdout.write(
  [
    `产物目录：${dist}`,
    `体积：约 ${mb} MB`,
    "",
    "启动方式：",
    "  Windows      双击 dist\\start.cmd（或在该目录执行 node start.mjs）",
    "  Linux/macOS  ./dist/start.sh（或 node dist/start.mjs）",
    "",
    "密钥配置：把 .env.local 放在 dist/app 目录下。",
    "",
  ].join("\n"),
);
