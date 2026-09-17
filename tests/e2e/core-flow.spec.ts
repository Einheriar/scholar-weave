import { expect, test } from "@playwright/test";
import { gotoApp, loadSample, paragraphTexts, scrollCardIntoView } from "./helpers";

/**
 * 核心交互流程（阶段 6 验收：核心流程在全新浏览器环境无需开发者干预即可完成）。
 *
 * 这一组用例只用内置样例数据（不触网、不依赖 API Key），覆盖：
 * 三层建议展示 → 双向定位 → 单条接受改正文 → 撤销逐字还原 → 过期建议不可执行
 * → 复制全文 → 键盘快捷键。
 *
 * 每个用例都是全新的 browser context，IndexedDB 为空，应用会载入样例。
 */

/** 取某条建议的侧栏卡片 */
function card(page: import("@playwright/test").Page, id: string) {
  return page.locator(`[data-review-card="${id}"]`);
}

test.describe("核心流程：三层建议与定位", () => {
  test("首屏载入样例并展示三层建议分区", async ({ page }) => {
    await gotoApp(page);
    await loadSample(page);

    // 三个范围区都是可访问的 landmark
    await expect(page.getByRole("region", { name: "全文审阅" })).toBeVisible();
    await expect(page.getByRole("region", { name: "段落意见" })).toBeVisible();
    await expect(page.getByRole("region", { name: "具体修改" })).toBeVisible();

    // 三层各至少一条
    await expect(card(page, "review_doc_1")).toBeVisible();
    await expect(card(page, "review_blk_1")).toBeVisible();
    await expect(card(page, "review_edit_1")).toBeVisible();

    // 正文里 range 建议渲染为带 data-review-id 的下划线标记；document 级不画标记
    await expect(
      page.locator('[data-review-id="review_edit_1"]').first(),
    ).toBeVisible();
    await expect(page.locator('[data-review-id="review_doc_1"]')).toHaveCount(0);
  });

  test("按范围筛选时只显示当前范围的建议分区", async ({ page }) => {
    await gotoApp(page);
    await loadSample(page);
    const reviewSidebar = page.getByRole("complementary", { name: "审阅建议侧栏" });

    for (const [label, regionName, cardId] of [
      ["全文", "全文审阅", "review_doc_1"],
      ["段落", "段落意见", "review_blk_1"],
      ["局部", "具体修改", "review_edit_1"],
    ] as const) {
      await page.getByRole("button", { name: new RegExp(`^${label}\\s`) }).click();
      await expect(reviewSidebar.getByRole("region")).toHaveCount(1);
      await expect(reviewSidebar.getByRole("region", { name: regionName })).toBeVisible();
      await expect(card(page, cardId)).toBeVisible();
    }
  });

  test("侧栏 → 正文：点击局部建议卡片后正文选中对应文本", async ({ page }) => {
    await gotoApp(page);
    await loadSample(page);

    // 侧栏是 sticky + 内部滚动容器，先显式滚进容器可视区再点（见 helpers.scrollCardIntoView）
    await scrollCardIntoView(page, "review_edit_5");
    await card(page, "review_edit_5").click();

    // 卡片进入选中态
    await expect(card(page, "review_edit_5")).toHaveAttribute(
      "aria-current",
      "true",
    );

    // 编辑器获得焦点，且选区落在该建议的原文范围上（PLAN 6.2）
    await expect(page.locator(".ProseMirror")).toBeFocused();
    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
    expect(selected).toBe("overlooking the interpersonal part");
  });

  test("正文 → 侧栏：点击正文标记后对应卡片被选中", async ({ page }) => {
    await gotoApp(page);
    await loadSample(page);

    await page.locator('[data-review-id="review_edit_5"]').first().click();

    await expect(card(page, "review_edit_5")).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  test("过期建议不可执行且有明确提示", async ({ page }) => {
    await gotoApp(page);
    await loadSample(page);

    const stale = card(page, "review_edit_stale");
    await expect(stale).toBeVisible();
    await expect(stale.getByText("原文已变化，无法定位")).toBeVisible();
    // 没有“接受”按钮
    await expect(
      stale.getByRole("button", { name: "接受", exact: true }),
    ).toHaveCount(0);
  });
});

test.describe("核心流程：接受、撤销与复制", () => {
  test("接受一条局部修改会改正文，撤销后逐字还原", async ({ page }) => {
    await gotoApp(page);
    await loadSample(page);

    const editorUndo = page.getByRole("button", { name: "撤销正文编辑" });
    await expect(editorUndo).toBeDisabled();
    const before = await paragraphTexts(page);
    expect(before[4]).toContain("may already been decided");
    expect(before[4]).not.toContain("may already have been decided");

    // 接受（先滚进侧栏可视区，sticky 容器内 Playwright 的自动滚动失效）
    await scrollCardIntoView(page, "review_edit_1");
    await card(page, "review_edit_1")
      .getByRole("button", { name: "接受", exact: true })
      .click();

    await expect(card(page, "review_edit_1").getByText("已接受")).toBeVisible();
    // 单条建议由卡片自己的安全撤销负责，不污染普通正文撤销栈。
    await expect(editorUndo).toBeDisabled();
    await expect
      .poll(async () => (await paragraphTexts(page))[4])
      .toContain("may already have been decided");

    // 撤销（同一张卡片的“撤销”按钮；接受后正文变化可能重排侧栏，重新滚进视野）
    await scrollCardIntoView(page, "review_edit_1");
    await card(page, "review_edit_1")
      .getByRole("button", { name: "撤销", exact: true })
      .click();

    await expect(card(page, "review_edit_1").getByText("待处理")).toBeVisible();
    await expect
      .poll(async () => (await paragraphTexts(page))[4])
      .toContain("may already been decided");

    // 逐字还原：整篇文本与接受前完全一致
    expect(await paragraphTexts(page)).toEqual(before);
  });

  test("右上角按钮可撤销当前会话中的正文编辑", async ({ page }) => {
    await gotoApp(page);
    await loadSample(page);

    const before = await paragraphTexts(page);
    const editor = page.locator(".ProseMirror");
    const undo = page.getByRole("button", { name: "撤销正文编辑" });
    await expect(undo).toBeDisabled();
    await expect(page.getByRole("tooltip")).toHaveText("撤销 / Ctrl+Z");

    await editor.press("Control+Home");
    await editor.type("x");
    await expect(undo).toBeEnabled();

    await undo.click();
    await expect.poll(() => paragraphTexts(page)).toEqual(before);
    await expect(undo).toBeDisabled();
  });

  test("点击“复制全文”把整篇文本写入剪贴板", async ({ page }) => {
    await gotoApp(page);
    await loadSample(page);

    await page.getByRole("button", { name: "复制全文" }).click();
    await expect(page.getByRole("button", { name: /已复制/ })).toBeVisible();

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    const paras = await paragraphTexts(page);
    // Windows 剪贴板把换行规范化为 CRLF，比较前归一化，避免平台差异误报
    expect(clipboard.replace(/\r\n/g, "\n")).toBe(paras.join("\n\n"));
  });

  test("清空项目仅重置当前现场并立即持久化", async ({ page }) => {
    await gotoApp(page);
    await loadSample(page);

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "清空项目" }).click();

    await expect(page.getByLabel("文档标题")).toHaveValue("");
    await expect(page.locator("[data-review-card]")).toHaveCount(0);
    await expect.poll(() => paragraphTexts(page)).toEqual([""]);
    await expect(page.getByRole("status").first()).toContainText("已保存到本地");

    // 清空后的同一项目已立即落库，刷新不会恢复旧正文或建议。
    await page.reload();
    await expect(page.locator(".ProseMirror")).toBeVisible();
    await expect(page.getByLabel("文档标题")).toHaveValue("");
    await expect.poll(() => paragraphTexts(page)).toEqual([""]);
    await expect(page.locator("[data-review-card]")).toHaveCount(0);
  });
});

test.describe("核心流程：键盘快捷键", () => {
  test("Cmd/Ctrl+Shift+C 复制全文", async ({ page }) => {
    await gotoApp(page);
    await loadSample(page);

    await page.keyboard.press("Control+Shift+C");
    await expect(page.getByRole("button", { name: /已复制/ })).toBeVisible();

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    const paras = await paragraphTexts(page);
    expect(clipboard.replace(/\r\n/g, "\n")).toBe(paras.join("\n\n"));
  });

  test("对话输入框聚焦时 Cmd/Ctrl+Enter 不触发审阅", async ({ page }) => {
    await gotoApp(page);
    await loadSample(page);

    await page.getByLabel("对话输入框").focus();
    await page.keyboard.press("Control+Enter");

    // 不应进入审阅 loading 态
    await expect(page.getByText("正在审阅文档…")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "开始审阅" })).toBeVisible();
  });
});
