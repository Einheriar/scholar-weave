import type { ReactNode } from "react";

/**
 * 受限 markdown 渲染器（不引第三方库）。
 *
 * 只支持提示词/解释文案常用的子集，遇到不认识的结构一律按纯文本回落，
 * 因此渲染结果永远安全（不会把模型输出的任意文本变成可点击链接等）：
 * - 段落（空行分段）
 * - ATX 标题：# / ## / ###（# 后必须跟空格）
 * - 无序列表：- 或 *（行首，后必须跟空格；支持 2/4 空格缩进嵌套）
 * - 有序列表：1. 2. …（后必须跟空格）
 * - 行内：**加粗**、*斜体*、`代码`（行内规则不跨行；** 优先于 *）
 * - 分隔线：--- 单独成行
 *
 * 设计取向见 AGENTS.md「界面开发约定」：这是给 LLM 解释文案与
 * 「自定义指令」输入框用的，协议越受限，模型越容易稳定输出。
 */

type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string };

/** 按 **..** → `..` → *..* 的优先级切分行内片段（不跨行） */
function tokenizeInline(line: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let last = 0;
  for (const m of line.matchAll(re)) {
    const idx = m.index;
    if (idx > last) tokens.push({ kind: "text", text: line.slice(last, idx) });
    const raw = m[0];
    if (raw.startsWith("**")) {
      tokens.push({ kind: "bold", text: raw.slice(2, -2) });
    } else if (raw.startsWith("`")) {
      tokens.push({ kind: "code", text: raw.slice(1, -1) });
    } else {
      tokens.push({ kind: "italic", text: raw.slice(1, -1) });
    }
    last = idx + raw.length;
  }
  if (last < line.length) tokens.push({ kind: "text", text: line.slice(last) });
  return tokens;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return tokenizeInline(text).map((t, i) => {
    const key = `${keyPrefix}-i${i}`;
    switch (t.kind) {
      case "bold":
        return (
          <strong key={key} className="font-semibold">
            {t.text}
          </strong>
        );
      case "italic":
        return (
          <em key={key} className="italic">
            {t.text}
          </em>
        );
      case "code":
        return (
          <code
            key={key}
            className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[0.85em]"
          >
            {t.text}
          </code>
        );
      default:
        return t.text;
    }
  });
}

type ListItem = { indent: number; ordered: boolean; content: string };

function listItemOf(line: string): ListItem | null {
  const indent = line.match(/^\s*/)?.[0].length ?? 0;
  const rest = line.slice(indent);
  const ul = rest.match(/^[-*]\s+/);
  if (ul) return { indent, ordered: false, content: rest.slice(ul[0].length) };
  const ol = rest.match(/^\d+[.、]\s+/);
  if (ol) return { indent, ordered: true, content: rest.slice(ol[0].length) };
  return null;
}

/** 把一组连续列表行渲染成嵌套 <ul>/<ol> */
function renderList(
  items: ListItem[],
  baseIndent: number,
  keyPrefix: string,
): ReactNode {
  const nodes: ReactNode[] = [];
  let i = 0;
  while (i < items.length) {
    const first = items[i];
    // 当前子列表：从 first 起，直到出现比 first.indent 更小的行
    let j = i + 1;
    while (j < items.length && items[j].indent >= first.indent) j++;
    const group = items.slice(i, j);
    // 组内再按 ordered 拆（相邻同类合并成一个 <ul>/<ol>）
    let k = 0;
    while (k < group.length) {
      const ordered = group[k].ordered;
      let m = k + 1;
      while (m < group.length && group[m].ordered === ordered) m++;
      const sameType = group.slice(k, m);
      const children = sameType.map((it, n) => {
        // 该 <li> 之下、缩进更深的行是它的子列表
        const childStart = items.indexOf(it) + 1;
        let childEnd = childStart;
        while (
          childEnd < items.length &&
          items[childEnd].indent > it.indent &&
          items[childEnd].indent <= baseIndent + 4
        ) {
          childEnd++;
        }
        const sub = items.slice(childStart, childEnd);
        const nested =
          sub.length > 0 ? renderList(sub, it.indent + 1, `${keyPrefix}-n`) : null;
        return (
          <li key={`${keyPrefix}-${i}-${k}-${n}`}>
            {renderInline(it.content, `${keyPrefix}-li${i}${k}${n}`)}
            {nested}
          </li>
        );
      });
      nodes.push(
        ordered ? (
          <ol key={`${keyPrefix}-ol${i}-${k}`} className="list-decimal pl-5">
            {children}
          </ol>
        ) : (
          <ul key={`${keyPrefix}-ul${i}-${k}`} className="list-disc pl-5">
            {children}
          </ul>
        ),
      );
      k = m;
    }
    i = j;
  }
  // key 给这个块级容器：renderList 的返回值会被 push 进 renderMiniMarkdown 的 blocks 数组
  // 成列表渲染，缺 key 会报「Each child in a list should have a unique key prop」
  // （其余 block 的 p/h/hr 都自带 key，这里漏了）。嵌套调用时多一个 key 无害。
  return (
    <div key={keyPrefix} className="space-y-1">
      {nodes}
    </div>
  );
}

/** 判断一行是否属于当前列表（在列表块内部被连续行调用） */
function isListLine(line: string): boolean {
  return listItemOf(line) !== null;
}

/**
 * 把受限 markdown 文本渲染成 React 节点。
 * 渲染结果是纯展示（无链接、无图片、无 HTML），可安全用于模型输出。
 */
export function renderMiniMarkdown(text: string): ReactNode {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let key = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(
      <p key={`p${key++}`} className="my-1 first:mt-0 last:mb-0">
        {renderInline(paragraph.join(" "), `p${key}`)}
      </p>,
    );
    paragraph = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 空行：段落边界
    if (line.trim() === "") {
      flushParagraph();
      i++;
      continue;
    }

    // 标题（# 后必须跟空格，避免把普通井号当标题）
    const h = line.match(/^(#{1,3})\s+/);
    if (h) {
      flushParagraph();
      const level = h[1].length;
      const content = line.slice(h[0].length);
      const cls =
        level === 1
          ? "my-1.5 font-semibold text-foreground first:mt-0"
          : level === 2
            ? "my-1 font-medium text-foreground first:mt-0"
            : "my-1 text-sm font-medium text-foreground first:mt-0";
      const Tag = (`h${level}`) as "h1" | "h2" | "h3";
      blocks.push(
        <Tag key={`h${key++}`} className={cls}>
          {renderInline(content, `h${key}`)}
        </Tag>,
      );
      i++;
      continue;
    }

    // 分隔线：单独一行的 ---（前后必须是空行或文本边界）
    if (/^\s*---+\s*$/.test(line)) {
      flushParagraph();
      blocks.push(<hr key={`hr${key++}`} className="my-2 border-border" />);
      i++;
      continue;
    }

    // 列表：收集连续列表行（含缩进子项）
    if (isListLine(line)) {
      flushParagraph();
      const items: ListItem[] = [];
      const baseIndent = listItemOf(line)!.indent;
      while (i < lines.length && isListLine(lines[i])) {
        items.push(listItemOf(lines[i])!);
        i++;
      }
      blocks.push(renderList(items, baseIndent, `l${key++}`));
      continue;
    }

    // 普通行：并入当前段落
    paragraph.push(line);
    i++;
  }
  flushParagraph();

  return <div className="space-y-1">{blocks}</div>;
}
