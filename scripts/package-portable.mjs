import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 生成 Windows 绿色版（免安装 zip）。
 *
 * 产物：src-tauri/target/release/bundle/portable/superGrammarly_<version>_x64-portable.zip
 * 内含：superGrammarly.exe + LICENSE + README.txt，解压即可双击运行。
 *
 * 默认先跑一次 `tauri build`，保证 zip 里是与当前源码一致的 release 二进制；
 * 想复用已有构建加 `--skip-build`。
 *
 * 注意：必须用真正的 ZIP 打包。早先手工发布时把 tar 归档改名成 .zip，
 * 部分解压工具直接报错；这里统一走 Compress-Archive，并在结束时校验文件头。
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleDir = path.join(root, "src-tauri", "target", "release", "bundle", "portable");
const stageDir = path.join(bundleDir, "supergrammarly-portable");
const exe = path.join(root, "src-tauri", "target", "release", "app.exe");
const skipBuild = process.argv.includes("--skip-build");

const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const version = pkg.version;
const zipPath = path.join(bundleDir, `superGrammarly_${version}_x64-portable.zip`);

const log = (msg) => process.stdout.write(`\n▶ ${msg}\n`);

if (!skipBuild) {
  log("构建 Tauri release（含前端 Vite 构建）");
  const build = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tauri", "build"],
    { cwd: root, stdio: "inherit" },
  );
  if (build.status !== 0) {
    console.error("\n构建失败，已中止打包。");
    process.exit(build.status ?? 1);
  }
}

if (!existsSync(exe)) {
  console.error(
    `\n没有找到 ${exe}。\n先运行 npx tauri build，或去掉 --skip-build 重新打包。`,
  );
  process.exit(1);
}

log("组装绿色版目录");
await rm(stageDir, { recursive: true, force: true });
await mkdir(stageDir, { recursive: true });
await copyFile(exe, path.join(stageDir, "superGrammarly.exe"));
await copyFile(path.join(root, "LICENSE"), path.join(stageDir, "LICENSE"));

// 文件名与内容都保持 ASCII：中文文件名在部分解压工具里会变成乱码。
await writeFile(
  path.join(stageDir, "README.txt"),
  [
    "superGrammarly - AI Document Review (Portable)",
    "==============================================",
    "",
    "How to run",
    "----------",
    "Double-click superGrammarly.exe. No Node.js installation is required and",
    "nothing is written to the registry. The folder can be moved anywhere",
    "(USB drive, desktop, another disk).",
    "",
    "Microsoft Edge WebView2 Runtime is required. Windows 10/11 normally ships",
    "with it; if the window opens but stays blank, install it first:",
    "https://developer.microsoft.com/microsoft-edge/webview2/",
    "",
    "Configure a model",
    "-----------------",
    "Open the settings gear at the bottom-left, then the \"Model\" tab, and fill in:",
    "  - API base URL (e.g. https://api.deepseek.com/v1)",
    "  - API key",
    "  - Model name",
    "This configuration is stored only in local storage on this machine.",
    "",
    "Data and privacy",
    "----------------",
    "Articles, suggestions and chat history are kept in local IndexedDB.",
    "Content is sent to your configured model provider only when you start a",
    "review or a conversation.",
    "",
    `Version: ${version}`,
    "",
  ].join("\n"),
  "utf8",
);

log("压缩为 ZIP");
await rm(zipPath, { force: true });
const compress = spawnSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path '${path.join(stageDir, "*")}' -DestinationPath '${zipPath}' -CompressionLevel Optimal -Force`,
  ],
  { stdio: "inherit" },
);
if (compress.status !== 0) {
  console.error("\n压缩失败，已中止。");
  process.exit(compress.status ?? 1);
}

// Compress-Archive 正常时以 PK 开头；若拿到 tar 头说明压缩方式又跑偏了。
const head = (await readFile(zipPath)).subarray(0, 4);
if (head[0] !== 0x50 || head[1] !== 0x4b) {
  console.error(`\n产物不是 ZIP（文件头 ${head.toString("hex")}），请检查压缩命令。`);
  process.exit(1);
}

const sha256 = createHash("sha256").update(await readFile(zipPath)).digest("hex");
const { size } = await stat(zipPath);
log("完成");
process.stdout.write(
  [
    `产物：${zipPath}`,
    `体积：${(size / 1024 / 1024).toFixed(1)} MB`,
    `SHA-256：${sha256}`,
    "",
  ].join("\n"),
);
