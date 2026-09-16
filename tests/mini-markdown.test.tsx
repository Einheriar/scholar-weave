import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderMiniMarkdown } from "@/lib/mini-markdown";

function render(text: string): string {
  return renderToStaticMarkup(<>{renderMiniMarkdown(text)}</>);
}

describe("renderMiniMarkdown", () => {
  it("纯文本渲染成段落", () => {
    const html = render("你好，世界。");
    expect(html).toContain("你好，世界。");
    expect(html).toContain("<p");
  });

  it("空行分段", () => {
    const html = render("第一段。\n\n第二段。");
    expect(html.match(/<p/g)?.length).toBe(2);
  });

  it("支持 #/##/### 标题", () => {
    const html = render("# 大标题\n\n## 中标题\n\n### 小标题");
    expect(html).toContain("<h1");
    expect(html).toContain("大标题");
    expect(html).toContain("<h2");
    expect(html).toContain("中标题");
    expect(html).toContain("<h3");
    expect(html).toContain("小标题");
  });

  it("# 后无空格不当标题", () => {
    const html = render("C# 是一门语言");
    expect(html).not.toContain("<h1");
    expect(html).toContain("C# 是一门语言");
  });

  it("支持无序列表", () => {
    const html = render("- 苹果\n- 香蕉");
    expect(html).toContain("<ul");
    expect(html).toContain("<li");
    expect(html).toContain("苹果");
    expect(html).toContain("香蕉");
  });

  it("支持 * 作为无序列表标记", () => {
    const html = render("* 项目一");
    expect(html).toContain("<ul");
    expect(html).toContain("项目一");
  });

  it("支持有序列表", () => {
    const html = render("1. 第一步\n2. 第二步");
    expect(html).toContain("<ol");
    expect(html).toContain("第一步");
    expect(html).toContain("第二步");
  });

  it("支持嵌套列表（缩进子项）", () => {
    const html = render("- 父项\n  - 子项");
    expect(html).toContain("<ul");
    expect(html).toContain("父项");
    expect(html).toContain("子项");
    // 嵌套的 ul 应该在 li 内部
    expect(html.indexOf("子项")).toBeGreaterThan(html.indexOf("父项"));
  });

  it("支持加粗", () => {
    const html = render("这是**重点**内容");
    expect(html).toContain("<strong");
    expect(html).toContain("重点");
  });

  it("支持斜体", () => {
    const html = render("这是*斜体*词");
    expect(html).toContain("<em");
    expect(html).toContain("斜体");
  });

  it("支持行内代码", () => {
    const html = render("用 `blockId` 字段定位");
    expect(html).toContain("<code");
    expect(html).toContain("blockId");
  });

  it("加粗优先于斜体（** 不被切成两个 *）", () => {
    const html = render("**重要**");
    expect(html).toContain("<strong");
    expect(html).not.toContain("<em");
  });

  it("行内标记不跨行", () => {
    const html = render("这是**未闭合\n换行的文本");
    expect(html).toContain("**未闭合");
    expect(html).not.toContain("<strong");
  });

  it("不认识的分隔线语法不当列表", () => {
    const html = render("---");
    expect(html).toContain("<hr");
  });

  it("普通段落里的连字符不当列表", () => {
    const html = render("这是 - 不是列表项的行内用法");
    expect(html).not.toContain("<ul");
    expect(html).toContain("不是列表项的行内用法");
  });

  // 回归：列表块（renderList 的容器 div）漏了 key，被 push 进 blocks 数组后
  // 触发 React「Each child in a list should have a unique "key" prop」警告。
  // 列表与其它 block 混排时才暴露，所以这里同时放标题/段落/列表。
  it("混合块渲染不产生 React key 警告", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render("# 标题\n\n段落一。\n\n- 甲\n- 乙\n\n1. 一\n2. 二\n\n---\n\n段落二。");
    const warnings = spy.mock.calls.map((c) => String(c[0]));
    spy.mockRestore();
    expect(warnings.filter((w) => w.includes("unique") && w.includes("key"))).toEqual([]);
  });

  it("嵌套列表也不产生 key 警告", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render("- 父项\n  - 子项\n  - 子项二\n- 父项二");
    const warnings = spy.mock.calls.map((c) => String(c[0]));
    spy.mockRestore();
    expect(warnings.filter((w) => w.includes("unique") && w.includes("key"))).toEqual([]);
  });
});
