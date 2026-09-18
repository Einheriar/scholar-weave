import { expect, test } from "@playwright/test";
import {
  type ChatRequestCapture,
  MOCK_REVIEW_SUMMARY,
  gotoApp,
  loadSample,
  mockChangeSetRoute,
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

  test("审阅请求失败时可手动重试", async ({ page }) => {
    await mockReviewRoute(page, { failFirst: true });
    await gotoApp(page);

    await page.getByRole("button", { name: "开始审阅" }).click();

    const alert = page.locator('[role="alert"]').filter({
      hasText: "LLM 调用失败（mock）。",
    });
    await expect(alert).toContainText("LLM 调用失败（mock）。");
    await alert.getByRole("button", { name: "重试审阅" }).click();
    await expect(page.getByText(MOCK_REVIEW_SUMMARY)).toBeVisible();
  });

  test("按意见生成修改失败时可手动重试", async ({ page }) => {
    await mockReviewRoute(page);
    await mockChangeSetRoute(page, { failFirst: true });
    await gotoApp(page);
    await page.getByRole("button", { name: "开始审阅" }).click();

    await card(page, "m_doc")
      .getByRole("button", { name: "按此意见修改" })
      .click();
    const alert = page.locator('[role="alert"]').filter({
      hasText: "生成修改集失败（mock）。",
    });
    await expect(alert).toContainText("生成修改集失败（mock）。");
    await alert.getByRole("button", { name: "重试生成" }).click();

    await expect(page.getByRole("dialog", { name: "修改集预览" })).toBeVisible();
    await expect(page.getByText("按意见生成的修改（mock）。")).toBeVisible();
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

  test("审阅意见可以忽略并撤销回待处理状态", async ({ page }) => {
    await mockReviewRoute(page);
    await gotoApp(page);
    await page.getByRole("button", { name: "开始审阅" }).click();

    const opinion = card(page, "m_doc");
    await expect(opinion.getByRole("button", { name: "忽略" })).toBeVisible();
    const expandedHeight = (await opinion.boundingBox())!.height;
    await opinion.getByRole("button", { name: "忽略" }).click();

    await expect(opinion.getByLabel("状态：已忽略")).toBeVisible();
    await expect(opinion.locator(".review-card-collapsible")).toHaveClass(
      /collapsed/,
    );
    await expect
      .poll(async () => (await opinion.boundingBox())?.height ?? 0)
      .toBeLessThan(expandedHeight);
    await expect(opinion.getByRole("button", { name: "继续询问" })).toHaveCount(0);
    await expect(opinion.getByRole("button", { name: "按此意见修改" })).toHaveCount(0);

    await opinion.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(opinion.getByLabel("状态：待处理")).toBeVisible();
    await expect(opinion.locator(".review-card-collapsible")).not.toHaveClass(
      /collapsed/,
    );
    await expect(opinion.getByRole("button", { name: "忽略" })).toBeVisible();
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
  test("标题栏空白区域可直接收起和展开聊天区", async ({ page }) => {
    await gotoApp(page);
    await loadSample(page);

    const headerToggle = page.getByRole("button", {
      name: "切换聊天区展开状态",
    });
    const chatBody = page.locator(".chat-body");
    await expect(headerToggle).toBeVisible();
    await expect(headerToggle).toHaveText("");
    await expect
      .poll(async () => (await headerToggle.boundingBox())?.width ?? 0)
      .toBeGreaterThan(100);

    await headerToggle.click();
    await expect(page.getByRole("button", { name: "展开聊天区" })).toBeVisible();
    await expect
      .poll(async () => (await chatBody.boundingBox())?.height ?? -1)
      .toBe(0);

    await headerToggle.click();
    await expect(page.getByRole("button", { name: "最小化聊天区" })).toBeVisible();
    await expect
      .poll(async () => (await chatBody.boundingBox())?.height ?? 0)
      .toBeGreaterThan(0);
  });

  test("无局部锚点时包含全文会解锁发送，并发送最新版本全文", async ({ page }) => {
    let captured: ChatRequestCapture | null = null;
    await mockChatRoute(page, {
      onRequest: (body) => {
        captured = body;
      },
    });
    await gotoApp(page);
    await loadSample(page);

    const input = page.getByLabel("对话输入框");
    const send = page.getByRole("button", { name: "发送", exact: true });
    await input.fill("请从全文角度检查这篇文章");
    await expect(send).toBeDisabled();

    const includeFull = page.getByRole("button", { name: "包含全文", exact: true });
    await includeFull.click();
    await expect(includeFull).toHaveAttribute("aria-pressed", "true");
    await expect(send).toBeEnabled();
    await expect(page.locator('[aria-label="上下文对话"]')).toContainText(
      "当前上下文：全文",
    );

    // 在真正发送前再修改正文，验证请求不是读取旧闭包里的文档快照。
    const firstParagraph = page.locator(".ProseMirror p").first();
    await firstParagraph.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" LATEST_SNAPSHOT");
    await input.press("Enter");

    await expect(
      page.getByText("这是纯解释回复（mock），不包含任何正文修改。"),
    ).toBeVisible();
    expect(captured).not.toBeNull();
    expect(captured!.includeFullDocument).toBe(true);
    expect(captured!.context).toEqual({ type: "document" });
    expect(captured!.blocks).toHaveLength(await page.locator(".ProseMirror p").count());
    expect(captured!.blocks[0].text).toContain("LATEST_SNAPSHOT");
  });

  test("总是包含全文会持久化为后续页面的默认值", async ({ page }) => {
    await gotoApp(page);
    await loadSample(page);

    const always = page.getByRole("button", { name: "总是包含全文" });
    await always.click();
    await expect(always).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("button", { name: "包含全文", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.localStorage.getItem("supergrammarly-chat-include-full-always"),
        ),
      )
      .toBe("true");

    await page.reload();
    await expect(page.locator(".ProseMirror")).toBeVisible();
    await expect(page.getByRole("button", { name: "总是包含全文" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      page.getByRole("button", { name: "包含全文", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("完整选中一个自然段时会自动附带全文，但仍以该段为讨论锚点", async ({ page }) => {
    let captured: ChatRequestCapture | null = null;
    await mockChatRoute(page, {
      onRequest: (body) => {
        captured = body;
      },
    });
    await gotoApp(page);
    await loadSample(page);

    const paragraphs = await paragraphTexts(page);
    const target = page.locator(".ProseMirror p").nth(1);
    await target.click({ clickCount: 3 });
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString().trim() ?? ""))
      .toBe(paragraphs[1].trim());
    await expect(
      page.getByRole("button", { name: "包含全文", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    await sendChatMessage(page, "结合全文检查这一段");
    await expect(
      page.getByText("这是纯解释回复（mock），不包含任何正文修改。"),
    ).toBeVisible();
    expect(captured).not.toBeNull();
    expect(captured!.includeFullDocument).toBe(true);
    expect(captured!.blocks).toHaveLength(paragraphs.length);
    expect(captured!.context).toMatchObject({
      type: "range",
      selectedText: paragraphs[1],
    });
  });

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

  test("对话失败时可原上下文重试且不重复提问", async ({ page }) => {
    await mockChatRoute(page, { withChanges: false, failFirst: true });
    await gotoApp(page);
    await loadSample(page);
    await selectTextInEditor(page, "upstanding");

    const question = "这条失败的提问只应出现一次";
    await sendChatMessage(page, question);
    const alert = page.locator('[role="alert"]').filter({
      hasText: "对话失败（mock）。",
    });
    await expect(alert).toContainText("对话失败（mock）。");
    await alert.getByRole("button", { name: "重试对话" }).click();

    await expect(
      page.getByText("这是纯解释回复（mock），不包含任何正文修改。"),
    ).toBeVisible();
    await expect(page.getByText(question, { exact: true })).toHaveCount(1);
  });

  test("讨论结论可转为审阅意见，刷新后可再次定位", async ({ page }) => {
    await mockChatRoute(page, { withReviewProposal: true });
    await gotoApp(page);
    await loadSample(page);
    await selectTextInEditor(page, "upstanding");
    await sendChatMessage(page, "把刚才讨论出的方案记成一条审阅意见");

    await expect(
      page.getByText("这项讨论已经形成一个可以进入审阅流程的方案。"),
    ).toBeVisible();
    const convertButton = page.getByRole("button", {
      name: "转为审阅意见",
    });
    await expect(convertButton).toBeVisible();
    expect(
      await convertButton.evaluate((element) => ({
        animationName: getComputedStyle(element).animationName,
        boxShadow: getComputedStyle(element).boxShadow,
      })),
    ).toEqual({
      animationName: "review-proposal-action-in",
      boxShadow: "none",
    });

    await convertButton.click();
    const createdCard = page
      .locator("[data-review-card]")
      .filter({ hasText: "统一脑区缩写形式" });
    await expect(createdCard).toHaveCount(1);
    await expect(createdCard.getByLabel("状态：待处理")).toBeVisible();
    await expect(createdCard.getByText("同一段内应统一使用缩写", { exact: false })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "查看审阅意见" }),
    ).toBeVisible();
    await expect(page.getByRole("status").first()).toContainText("已保存到本地");

    await page.reload();
    await expect(page.locator(".ProseMirror")).toBeVisible();
    const restoredCard = page
      .locator("[data-review-card]")
      .filter({ hasText: "统一脑区缩写形式" });
    await expect(restoredCard).toHaveCount(1);
    const viewButton = page.getByRole("button", { name: "查看审阅意见" });
    const chat = page.getByLabel("上下文对话");
    const messageCollapse = page.locator("[data-chat-message-collapse]");
    expect(
      await messageCollapse.evaluate(
        (element) => getComputedStyle(element).transitionDuration,
      ),
    ).toBe("0.44s");
    await expect(viewButton).toBeVisible();
    await viewButton.click();
    await expect(chat).toHaveAttribute("data-chat-context-transition", "out");
    await expect(restoredCard).toHaveAttribute("aria-current", "true");
    expect(
      await restoredCard.evaluate(
        (element) => getComputedStyle(element, "::after").animationName,
      ),
    ).toBe("review-card-focus-arrive");
    await expect(chat).toHaveAttribute("data-chat-context-transition", "idle");
    await expect(messageCollapse).toHaveAttribute("data-open", "false");
    await expect
      .poll(async () => (await messageCollapse.boundingBox())?.height ?? -1)
      .toBe(0);
    await expect(restoredCard).toHaveCount(1);
  });

  test("拖拽把手会直接改变聊天消息区高度", async ({ page }) => {
    await mockChatRoute(page, { withChanges: false });
    await gotoApp(page);
    await loadSample(page);
    await selectTextInEditor(page, "upstanding");
    await sendChatMessage(page, "解释一下这个词");
    await expect(
      page.getByText("这是纯解释回复（mock），不包含任何正文修改。"),
    ).toBeVisible();

    const handle = page.getByRole("button", { name: "调整聊天区高度" });
    const messageList = page.locator("[data-chat-message-list]");
    const handleBox = await handle.boundingBox();
    const before = await messageList.boundingBox();
    expect(handleBox).not.toBeNull();
    expect(before).not.toBeNull();
    expect(handleBox!.height).toBeGreaterThanOrEqual(20);
    expect(
      await handle.evaluate((element) => ({
        borderTopWidth: getComputedStyle(element).borderTopWidth,
        borderBottomWidth: getComputedStyle(element).borderBottomWidth,
        headerBorderBottomWidth: getComputedStyle(
          element.closest('[aria-label="上下文对话"]')!.firstElementChild!,
        ).borderBottomWidth,
      })),
    ).toEqual({
      borderTopWidth: "0px",
      borderBottomWidth: "0px",
      headerBorderBottomWidth: "1px",
    });

    const startY = handleBox!.y + handleBox!.height / 2;
    // 系统 Chrome 在无头模式下偶尔不会把 page.mouse 的 move 合成为
    // PointerEvent；直接派发同一组 pointer 事件，验证组件实际监听的协议。
    await handle.dispatchEvent("pointerdown", {
      bubbles: true,
      clientY: startY,
      pointerId: 1,
    });
    await page.evaluate((clientY) => {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientY,
          pointerId: 1,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientY,
          pointerId: 1,
        }),
      );
    }, startY - 96);

    await expect
      .poll(async () => (await messageList.boundingBox())?.height ?? 0)
      .toBeGreaterThan(before!.height + 80);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Number(window.localStorage.getItem("supergrammarly-chat-height")),
        ),
      )
      .toBeGreaterThan(400);
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
    await expect(page.getByRole("button", { name: "展开聊天区" })).toBeVisible();
    await expect
      .poll(async () => (await page.locator(".chat-body").boundingBox())?.height ?? -1)
      .toBe(0);
    await expect
      .poll(async () => {
        const previewBox = await dialog.boundingBox();
        const chatBox = await page
          .locator('[aria-label="上下文对话"]')
          .boundingBox();
        return Boolean(
          previewBox && chatBox && previewBox.y + previewBox.height <= chatBox.y + 1,
        );
      })
      .toBe(true);
    await expect(dialog.getByText("overlooking the interpersonal part")).toBeVisible();
    await expect(dialog.getByText("overlooking the interpersonal dimension")).toBeVisible();
    // 打开预览时焦点进入面板（无障碍：焦点管理）
    await expect(dialog.locator(":focus")).toHaveCount(1);

    // 普通放弃与 Escape 都恢复打开预览前的展开状态，且可以再次打开。
    await dialog.getByRole("button", { name: "放弃" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "最小化聊天区" })).toBeVisible();
    await previewButton.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "最小化聊天区" })).toBeVisible();
    await previewButton.click();
    await expect(dialog).toBeVisible();

    // 预览期间主动展开聊天等价于放弃，但回复中的修改集入口仍在，可再次打开。
    await page.getByRole("button", { name: "展开聊天区" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "最小化聊天区" })).toBeVisible();
    await expect(previewButton).toBeVisible();
    await previewButton.click();
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: /全部接受/ }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "最小化聊天区" })).toBeVisible();
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
    // 聊天区是 sticky 浮层，可能覆盖编辑器几何中心；直接聚焦后验证快捷键。
    await page.locator(".ProseMirror").focus();
    await page.keyboard.press("Control+z");

    await expect
      .poll(async () => (await paragraphTexts(page))[1])
      .toContain("overlooking the interpersonal part");
    expect(await paragraphTexts(page)).toEqual(before);
  });
});
