import { expect, test } from "@playwright/test";
import {
  MOCK_REVIEW_SUMMARY,
  gotoApp,
  loadSample,
  mockChatRoute,
  mockReviewRoute,
  paragraphTexts,
  selectTextInEditor,
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
  test("付费请求期间锁定当前文章，完成后恢复编辑", async ({ page }) => {
    let releaseRequest!: () => void;
    const pending = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    await page.route("**/api/review", async (route) => {
      const body = route.request().postDataJSON() as {
        revision: number;
        checksum: string;
      };
      await pending;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          documentSummary: "锁定测试完成",
          items: [],
          documentRevision: body.revision,
          checksum: body.checksum,
        }),
      });
    });
    await gotoApp(page);
    await loadSample(page);

    await page.getByRole("button", { name: "开始审阅" }).click();
    await expect(page.getByText("正在审阅文档…", { exact: false })).toBeVisible();
    await expect(page.getByLabel("文档标题")).toBeDisabled();
    await expect(page.locator(".ProseMirror")).toHaveAttribute(
      "contenteditable",
      "false",
    );
    const history = page.getByRole("complementary", { name: "历史记录" });
    await expect(history.getByRole("button", { name: "新文章" })).toBeDisabled();

    releaseRequest();
    await expect(page.getByText("锁定测试完成")).toBeVisible();
    await expect(page.getByLabel("文档标题")).toBeEnabled();
    await expect(page.locator(".ProseMirror")).toHaveAttribute(
      "contenteditable",
      "true",
    );
  });

  test("点击开始审阅后展示全文总结与三层建议", async ({ page }) => {
    await mockReviewRoute(page);
    await gotoApp(page);

    await page.getByRole("button", { name: "开始审阅" }).click();

    await expect(page.getByText(MOCK_REVIEW_SUMMARY)).toBeVisible();
    await expect(card(page, "m_doc")).toBeVisible();
    await expect(card(page, "m_block")).toBeVisible();
    await expect(card(page, "m_edit")).toBeVisible();
  });

  test("快捷键 Ctrl+Enter 也能触发审阅", async ({ page }) => {
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

  test("审阅结果与处理状态会持久化，刷新后仍可恢复", async ({ page }) => {
    await mockReviewRoute(page);
    await gotoApp(page);
    await page.getByRole("button", { name: "开始审阅" }).click();
    await expect(card(page, "m_edit")).toBeVisible();

    await card(page, "m_edit").getByRole("button", { name: "忽略" }).click();
    await expect(card(page, "m_edit").getByLabel("状态：已忽略")).toBeVisible();
    await expect(page.getByRole("status").first()).toContainText("已保存到本地");

    await page.reload();
    await expect(page.locator(".ProseMirror")).toBeVisible();
    await expect(card(page, "m_edit")).toBeVisible();
    await expect(card(page, "m_edit").getByLabel("状态：已忽略")).toBeVisible();
  });
});

test.describe("上下文对话（mock /api/chat）", () => {
  test("纯解释回复不改正文", async ({ page }) => {
    await mockChatRoute(page, { withChanges: false });
    await gotoApp(page);
    await loadSample(page);
    // 规则 11：先选中正文再提问
    await selectTextInEditor(page, "upstanding");

    const before = await paragraphTexts(page);
    await sendChatMessage(page, "解释一下这个词");

    await expect(
      page.getByText("这是纯解释回复（mock），不包含任何正文修改。"),
    ).toBeVisible();
    // 没有任何“预览修改”入口，正文不变
    await expect(page.getByRole("button", { name: /预览修改/ })).toHaveCount(0);
    expect(await paragraphTexts(page)).toEqual(before);
  });

  test("当前上下文标签与节点竖条都能定位回正文锚点", async ({ page }) => {
    await mockChatRoute(page, { withChanges: false });
    await gotoApp(page);
    await loadSample(page);
    await selectTextInEditor(page, "upstanding");
    await sendChatMessage(page, "解释一下这个词");
    await expect(
      page.getByText("这是纯解释回复（mock），不包含任何正文修改。"),
    ).toBeVisible();

    const contextAnchor = page.getByRole("button", {
      name: /定位到当前上下文正文/,
    });
    await contextAnchor.click();
    await expect
      .poll(() =>
        page.evaluate(() => (window.getSelection()?.toString() ?? "").trim()),
      )
      .toBe("upstanding");
    expect(
      await page.evaluate(() => {
        const selection = window.getSelection();
        const element = selection?.anchorNode?.parentElement;
        if (!element) return null;
        const style = getComputedStyle(element, "::selection");
        return {
          backgroundColor: style.backgroundColor,
          color: style.color,
        };
      }),
    ).toEqual({
      backgroundColor: "color(srgb 0.78698 0.845804 0.842196)",
      color: "rgb(26, 36, 32)",
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const selection = window.getSelection();
          const chat = document.querySelector('[aria-label="上下文对话"]');
          if (!selection?.rangeCount || !(chat instanceof HTMLElement)) return false;
          const rect = selection.getRangeAt(0).getBoundingClientRect();
          return rect.top >= 16 && rect.bottom <= chat.getBoundingClientRect().top - 8;
        }),
      )
      .toBe(true);

    await page.getByRole("button", { name: "聊天节点历史" }).click();
    const timeline = page.getByRole("dialog", { name: "聊天节点历史" });
    const identityAnchor = timeline.getByRole("button", {
      name: /定位到节点.*正文锚点/,
    });
    await expect(identityAnchor).toBeVisible();
    await identityAnchor.click();
    await expect(timeline).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => (window.getSelection()?.toString() ?? "").trim()),
      )
      .toBe("upstanding");
  });

  test("重新载入样例会清空旧聊天现场", async ({ page }) => {
    await mockChatRoute(page, { withChanges: false });
    await gotoApp(page);
    await loadSample(page);
    await selectTextInEditor(page, "upstanding");
    await sendChatMessage(page, "这条聊天之后应被清空");
    await expect(
      page.getByText("这是纯解释回复（mock），不包含任何正文修改。"),
    ).toBeVisible();

    await loadSample(page);
    await expect(
      page.getByText("这是纯解释回复（mock），不包含任何正文修改。"),
    ).toHaveCount(0);
  });

  test("带修改集的回复先预览，接受后才改正文", async ({ page }) => {
    await mockChatRoute(page, { withChanges: true });
    await gotoApp(page);
    await loadSample(page);
    // 规则 11：先选中正文再提问（mock 修改集锚定 "overlooking the interpersonal part"）
    await selectTextInEditor(page, "overlooking the interpersonal part");

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
    await loadSample(page);
    // 规则 11：先选中正文再提问
    await selectTextInEditor(page, "overlooking the interpersonal part");

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
