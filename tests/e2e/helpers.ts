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

/** 载入内置样例（含三层建议，不依赖 LLM） */
export async function loadSample(page: Page) {
  await page.getByRole("button", { name: "载入样例" }).click();
  await expect(page.locator("[data-review-card]").first()).toBeVisible();
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
