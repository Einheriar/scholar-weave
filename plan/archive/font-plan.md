# 字体改造实施方案（2026-09-16）

## 背景与目标

- **中文 UI + 编辑区**换用 MiSans（Regular 400）
- **英文编辑区**换用 Inter（可变字体，Latin 字符优先命中 Inter，CJK fallback 到 MiSans）
- 正文字号从 16px 抬到 **18px**，英文 `word-spacing` 微宽（0.3px）
- 多余的 MiSans 字重**暂保留**，等用户拍板后再删

## 字体资源（已就绪）

| 字体 | 来源 | 文件 | 大小 |
|------|------|------|------|
| MiSans Regular | 用户提供 | `font/woff2/MiSans-Regular.woff2` | ~4.9MB |
| Inter Variable | GitHub Release v4.1 | `font/inter/web/InterVariable.woff2` | 344KB |
| Inter Variable Italic | 同上 | `font/inter/web/InterVariable-Italic.woff2` | 380KB |

- 字体源文件复制到 `src/app/fonts/`（Next `localFont` 只认项目内路径）
- 删除 `font/inter/inter.zip`（33MB 无用）

## 改动清单

### 1. `src/app/layout.tsx`
- 移除 `Geist` / `Geist_Mono` 的 `next/font/google` 引用
- 改为 `next/font/local` 加载 `InterVariable.woff2`（`weight: "100 900"`）与 `MiSans-Regular.woff2`（`weight: "400"`）
- `html` 的 className 换成新 CSS 变量
- `<html lang>` 从 `"en"` 改为 `"zh-CN"`

### 2. `src/app/globals.css`
- `--font-sans: var(--font-misans), var(--font-inter), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- `body` 移除写死的 `font-family: Arial, Helvetica, sans-serif`
- `.ProseMirror`：`font-size: 1.125rem`（18px）、`word-spacing: 0.3px`、`line-height: 1.8` 不变

### 3. `.gitignore`
- 新增 `/font`（字体源文件不进库）

## 验证

- `typecheck` / `lint` / `test`（141 例）全跑
- 本地 dev 目检：中文 UI、英文编辑区、聊天/侧栏密度
- E2E 不跑（改动不触锚点/选区/mock）

## 已知风险

- `InterVariable.woff2` 是可变字体，`next/font/local` 若不支持 `weight: "100 900"` 字符串，退到具体字重数组或静态字重
- 18px 正文可能让侧栏/聊天区密度变化，属连带视觉调整，不动

## 暂不做的

- 不删 MiSans 多余字重（等用户拍板）
- 不 commit（改完等用户确认）
