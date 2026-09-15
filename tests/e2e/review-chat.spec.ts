import { expect, test } from "@playwright/test";
import {
  MOCK_REVIEW_SUMMARY,
  gotoApp,
  mockChatRoute,
  mockReviewRoute,
  paragraphTexts,
  sendChatMessage,
} from "./helpers";

/**
 * 审阅与对话流程（阶段 3 / 5 / 6）。
 *
 * /api/review 与 /api/chat 都被拦截，用固定响应验证前端接线，
 * 不依赖真实 API Key，也不消耗模型额度。
 */

function card(page: import("@playwright/test").Page, id: string) {
  return page.locator(`[data-review-card="${id}"]`);
}

test.describe("LLM 审阅（mock /api/review）", () => {
  test("点击开始审阅后展示全文总结与三层建议", async ({ page }) => {
    await mockReviewRoute(page);
    await gotoApp(page);

    await page.getByRole("button", { name: "开始审阅" }).click();

    await expect(page.getByText(MOCK_REVIEW_SUMMARY)).toBeVisible();
    await expect(card(page, "m_doc")).toBeVisible();
    await expect(card(page, "m_block")).toBeVisible();
    await expect(card(page, "m_edit")).toBeVisible();
  });

  test("快捷键 Cmd/Ctrl+Enter 也能触发审阅", async ({ page }) => {
    await mockReviewRoute(page);
    await gotoApp(page);

    await page.keyboard.press("Control+Enter");

    await expect(page.getByText(MOCK_REVIEW_SUMMARY)).toBeVisible();
    await expect(card(page, "m_edit")).toBeVisible();
  });

  test("审阅请求失败时显示错误状态", async ({ page }) => {
    await page.route("**/api/review", (route) =>
      route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "llm_error", message: "LLM 调用失败（mock）。" },
        }),
      }),
    );
    await gotoApp(page);

    await page.getByRole("button", { name: "开始审阅" }).click();

    await expect(page.locator('p[role="alert"]')).toContainText(
      "LLM 调用失败（mock）。",
    );
  });

  test("接受 mock 修改会改正文，撤销后还原", async ({ page }) => {
    await mockReviewRoute(page);
    await gotoApp(page);
    await page.getByRole("button", { name: "开始审阅" }).click();
    await expect(card(page, "m_edit")).toBeVisible();

    await card(page, "m_edit")
      .getByRole("button", { name: "接受", exact: true })
      .click();
    await expect
      .poll(async () => (await paragraphTexts(page))[4])
      .toContain("may already have been decided");

    await card(page, "m_edit")
      .getByRole("button", { name: "撤销", exact: true })
      .click();
    await expect
      .poll(async () => (await paragraphTexts(page))[4])
      .toContain("may already been decided");
    expect((await paragraphTexts(page))[4]).not.toContain(
      "may already have been decided",
    );
  });
});

test.describe("上下文对话（mock /api/chat）", () => {
  test("纯解释回复不改正文", async ({ page }) => {
    await mockChatRoute(page, { withChanges: false });
    await gotoApp(page);

    const before = await paragraphTexts(page);
    await sendChatMessage(page, "解释一下全文结构");

    await expect(
      page.getByText("这是纯解释回复（mock），不包含任何正文修改。"),
    ).toBeVisible();
    // 没有任何“预览修改”入口，正文不变
    await expect(page.getByRole("button", { name: /预览修改/ })).toHaveCount(0);
    expect(await paragraphTexts(page)).toEqual(before);
  });

  test("带修改集的回复先预览，接受后才改正文", async ({ page }) => {
    await mockChatRoute(page, { withChanges: true });
    await gotoApp(page);

    const before = await paragraphTexts(page);
    await sendChatMessage(page, "把这段改得更学术一些");

    // 回复只提供“预览修改”入口，正文尚未变化
    const previewButton = page.getByRole("button", { name: /预览修改/ });
    await expect(previewButton).toBeVisible();
    expect(await paragraphTexts(page)).toEqual(before);

    await previewButton.click();

    const dialog = page.getByRole("dialog", { name: "修改集预览" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("overlooking the interpersonal part")).toBeVisible();
    await expect(dialog.getByText("overlooking the interpersonal dimension")).toBeVisible();
    // 打开预览时焦点进入面板（无障碍：焦点管理）
    await expect(dialog.locator(":focus")).toHaveCount(1);

    await dialog.getByRole("button", { name: /全部接受/ }).click();

    await expect(dialog).toHaveCount(0);
    await expect
      .poll(async () => (await paragraphTexts(page))[1])
      .toContain("overlooking the interpersonal dimension");
  });

  test("批量接受修改集后可用 Ctrl+Z 撤销回原文", async ({ page }) => {
    await mockChatRoute(page, { withChanges: true });
    await gotoApp(page);

    const before = await paragraphTexts(page);
    await sendChatMessage(page, "把这段改得更学术一些");
    await page.getByRole("button", { name: /预览修改/ }).click();
    await page
      .getByRole("dialog", { name: "修改集预览" })
      .getByRole("button", { name: /全部接受/ })
      .click();

    await expect
      .poll(async () => (await paragraphTexts(page))[1])
      .toContain("overlooking the interpersonal dimension");

    // 编辑器的撤销栈：批量应用是一次事务，Ctrl+Z 应逐字还原
    await page.locator(".ProseMirror").click();
    await page.keyboard.press("Control+z");

    await expect
      .poll(async () => (await paragraphTexts(page))[1])
      .toContain("overlooking the interpersonal part");
    expect(await paragraphTexts(page)).toEqual(before);
  });
});
