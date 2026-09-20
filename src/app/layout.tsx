import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// 中文 UI + 编辑区（CJK 字符优先命中）
const misans = localFont({
  src: "./fonts/MiSans-Regular.woff2",
  variable: "--font-misans",
  weight: "400",
});

// 英文编辑区（Latin 字符优先命中，可变字体 100-900）
const inter = localFont({
  src: "./fonts/InterVariable.woff2",
  variable: "--font-inter",
  weight: "100 900",
});

// 保留等宽字体（API 预设徽标、设置面板代码框、mini-markdown 行内代码仍在用）
const geistMono = localFont({
  src: "./fonts/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "superGrammarly · AI 文档审阅",
  description: "本地优先的 AI 文档审阅工作台",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={`${misans.variable} ${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* 首帧前恢复用户手动选择的主题（ThemeToggle 存于 localStorage），避免深色闪白 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem("theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}})()`,
          }}
        />
      </head>
      <body className="theme-fade min-h-full flex flex-col">{children}</body>
    </html>
  );
}
