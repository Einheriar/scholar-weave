import { expect, type Page } from "@playwright/test";

/**
 * Playwright 用例的共享工具。
 *
 * 关键点：blockId 是运行时随机生成的（createDocument → crypto.randomUUID），
 * 用例无法写死。因此 mock 路由在**服务端侧**从请求体里按文本内容反查 blockId，
 * 再据此构造合法的建议/修改集锚点。
 */

export type Block = { id: string; text: string };

/** 打开应用并等待编辑器挂载（Tiptap 是 immediatelyRender:false，需等待水合后渲染） */
export async function gotoApp(page: Page) {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
}

/** 读取编辑器各段落的纯文本（按 DOM 顺序） */
export async function paragraphTexts(page: Page): Promise<string[]> {
  return page.locator(".ProseMirror p").evaluateAll((els) =>
    els.map((el) => el.textContent ?? ""),
  );
}

/** 载入内置样例（含三层建议，不依赖 LLM）。阶段 7 起入口在设置面板的“数据”Tab。 */
export async function loadSample(page: Page) {
  await page.getByRole("button", { name: "设置" }).click();
  const dialog = page.getByRole("dialog", { name: "设置" });
  await dialog.getByRole("button", { name: "数据" }).click();
  await dialog.getByRole("button", { name: "载入样例" }).click();
  await expect(page.locator("[data-review-card]").first()).toBeVisible();
  // 等防抖保存落库（建档时机：文档变化即保存），避免后续「新文章/切换」抢在保存前。
  // 保存状态是顶栏的 <span role="status">（另有一个 sr-only aria-live 也带 status，取第一个）。
  const saveStatus = page.getByRole("status").first();
  await expect(saveStatus).toContainText("已保存到本地");
}

/**
 * 把侧栏卡片滚进其滚动容器的可视区。
 *
 * 侧栏是 `position: sticky` + 内部 `overflow-y-auto`：Playwright 的
 * `scrollIntoViewIfNeeded` 只会滚 window，而 sticky 元素不随 window 滚动移动，
 * 导致视口下方的卡片永远报「element is outside of the viewport」（E2E 实测）。
 * 显式对其滚动容器调用 scrollIntoView 才能命中。
 */
export async function scrollCardIntoView(page: Page, id: string) {
  await page
    .locator(`[data-review-card="${id}"]`)
    .evaluate((el) => el.scrollIntoView({ block: "nearest" }));
}

/** 在请求体里按包含关系找到某段，返回其 blockId（找不到返回 undefined） */
export function findBlock(
  blocks: Block[],
  needle: string,
): Block | undefined {
  return blocks.find((b) => b.text.includes(needle));
}

export const MOCK_REVIEW_SUMMARY = "整体结构清晰，但结尾段落存在时态与搭配问题。";

/**
 * 拦截 POST /api/review，返回固定三层建议（避开真实 LLM 与 API Key）。
 * 锚点用请求体里的真实 blockId 与真实存在的原文片段。
 */
export async function mockReviewRoute(page: Page) {
  await page.route("**/api/review", async (route) => {
    const body = route.request().postDataJSON() as {
      revision: number;
      checksum: string;
      blocks: Block[];
    };
    const p2 = findBlock(body.blocks, "can form deceptive behavior");
    const p4 = findBlock(body.blocks, "deception or truth may already been decided");

    const items: unknown[] = [
      {
        id: "m_doc",
        documentRevision: body.revision,
        scope: { type: "document" },
        kind: "opinion",
        category: "structure",
        severity: "suggestion",
        title: "全文结构意见（mock）",
        explanation: "段落递进清晰，但结尾段落信息密度偏高。",
        status: "open",
      },
    ];
    if (p2) {
      items.push({
        id: "m_block",
        documentRevision: body.revision,
        scope: { type: "block", blockId: p2.id },
        kind: "opinion",
        category: "clarity",
        severity: "suggestion",
        title: "段落意见（mock）",
        explanation: "本段偏长，可考虑在结论前拆分。",
        status: "open",
      });
    }
    if (p4) {
      items.push({
        id: "m_edit",
        documentRevision: body.revision,
        scope: {
          type: "range",
          blockId: p4.id,
          original: "deception or truth may already been decided",
          prefix: "the decision-making process, ",
          suffix: " in this early assessment stage",
        },
        kind: "edit",
        category: "grammar",
        severity: "important",
        title: "时态错误（mock）",
        explanation: "现在完成时被动语态应为 may already have been decided。",
        replacement: "deception or truth may already have been decided",
        status: "open",
      });
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        documentSummary: MOCK_REVIEW_SUMMARY,
        items,
        documentRevision: body.revision,
        checksum: body.checksum,
      }),
    });
  });
}

/**
 * 拦截 POST /api/chat。
 * withChanges=true 时返回 answer_with_changes（附带一个可定位的修改集）；
 * 否则返回纯解释 answer。
 */
export async function mockChatRoute(
  page: Page,
  opts: { withChanges?: boolean } = {},
) {
  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON() as {
      revision: number;
      blocks: Block[];
    };
    if (!opts.withChanges) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          type: "answer",
          answer: "这是纯解释回复（mock），不包含任何正文修改。",
        }),
      });
      return;
    }
    const p1 = findBlock(body.blocks, "overlooking the interpersonal part");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        type: "answer_with_changes",
        answer: "我建议做一处措辞调整，让它更符合学术行文。",
        changeSet: {
          id: "cs_mock",
          documentRevision: body.revision,
          summary: "把口语化的 interpersonal part 改为学术表达。",
          edits: p1
            ? [
                {
                  id: "ce_1",
                  blockId: p1.id,
                  original: "overlooking the interpersonal part",
                  replacement: "overlooking the interpersonal dimension",
                  explanation: "更符合学术行文，且避免与前文重复。",
                  status: "pending",
                },
              ]
            : [],
        },
      }),
    });
  });
}

/** 在对话框里输入并发送（Enter 发送已是产品行为） */
export async function sendChatMessage(page: Page, text: string) {
  const box = page.getByLabel("对话输入框");
  await box.fill(text);
  await box.press("Enter");
}

/**
 * 在编辑器里选中包含指定片段的一段文字（规则 11：无选区禁止提问，
 * 节点化聊天必须先选中正文再发送）。通过双击目标词触发选区，
 * 编辑器 onSelectionUpdate 会回报 { blockId, text }。
 */
export async function selectTextInEditor(page: Page, needle: string) {
  // 找到包含目标片段的段落
  const para = page
    .locator(".ProseMirror p")
    .filter({ hasText: needle })
    .first();
  await expect(para).toBeVisible();

  // 浮动聊天区（sticky 贴底）可能遮住目标词，点击会落在面板遮挡处。
  // 轮询：把段落滚到聊天区上方，再取词坐标点击，直到真的选中目标词。
  const chat = page.locator('[aria-label="上下文对话"]');
  const chatBox = (await chat.boundingBox()) ?? { y: Number.POSITIVE_INFINITY, height: 0 };
  const chatTop = chatBox.y;

  const isPhrase = needle.includes(" ");
  const expectedPrefix = needle.slice(0, Math.min(needle.length, 12));
  const selectedPrefix = async (): Promise<string> => {
    const t =
      (await chat.getByText(/选区「/, { exact: false }).first().textContent()) ?? "";
    const m = t.match(/选区「([^」]*)」/);
    return m ? m[1] : "";
  };

  // 词可能被 chat-anchor 等 Decoration 拆散，叶子节点的几何中心不一定落在词上。
  // 用 Range 精确圈出 needle 的位置，双击该范围的中心，并校验真的选中了。
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const pt = await page.evaluate(([needle]) => {
        const pm = document.querySelector(".ProseMirror");
        if (!pm) return null;
        const tw = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT);
        let n: Node | null;
        while ((n = tw.nextNode())) {
          const txt = n.textContent ?? "";
          const i = txt.indexOf(needle as string);
          if (i >= 0) {
            const r = document.createRange();
            r.setStart(n, i);
            r.setEnd(n, i + (needle as string).length);
            const startRect = r.getClientRects()[0];
            const endRect = r.getClientRects()[r.getClientRects().length - 1];
            return {
              startX: startRect.x + 1,
              startY: startRect.y + startRect.height / 2,
              endX: endRect.x + endRect.width - 1,
              endY: endRect.y + endRect.height / 2,
              midX: startRect.x + (endRect.x + endRect.width - startRect.x) / 2,
              midY: startRect.y + startRect.height / 2,
            };
          }
        }
        return null;
      }, [needle]);
      if (!pt) throw new Error("找不到目标词的文本节点");
      // 词中心若在聊天区（sticky 贴底）内会被遮住：先把词顶滚到聊天区上方
      if (pt.midY > chatTop - 4) {
        await page.evaluate(
          ([dy]) => window.scrollBy(0, dy),
          [pt.midY - chatTop + 24],
        );
        await page.waitForTimeout(120);
        continue;
      }
      if (isPhrase) {
        // 多词短语：双击只选中一个词。先双击词尾定位焦点，再 Shift+点词首，
        // 让选区从词尾扩到词首覆盖整段（方向反了会缩回成只选第一个词）。
        await page.mouse.dblclick(pt.endX, pt.endY);
        await page.waitForTimeout(120);
        await page.keyboard.down("Shift");
        await page.mouse.click(pt.startX, pt.startY);
        await page.keyboard.up("Shift");
        await page.waitForTimeout(120);
      } else {
        await page.mouse.dblclick(pt.midX, pt.midY);
      }
      // 标签把原文截断到 12 字符（可能带省略号），所以做包含匹配而非全等
      await expect
        .poll(async () => (await selectedPrefix()).replace(/…$/, ""), { timeout: 2000 })
        .toContain(expectedPrefix);
      return; // 选区正确，结束
    } catch (e) {
      lastErr = e;
      await page.evaluate(() => window.scrollBy(0, -360));
      await page.waitForTimeout(150);
    }
  }
  // 失败诊断：当前选区前缀
  const cur = await selectedPrefix().catch(() => "<none>");
  throw new Error(
    `选不中目标词：${needle}（当前选区前缀="${cur}"，chatTop=${chatTop}，lastErr=${String(lastErr)}）`,
  );
}
