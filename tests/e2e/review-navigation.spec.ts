import { expect, test, type Page } from "@playwright/test";
import type { ReviewItem } from "../../src/lib/review-schema";
import { gotoApp, scrollCardIntoView } from "./helpers";

const LONG_TARGET = "the first uniquely anchored review passage";
const SECOND_TARGET = "the second uniquely anchored review passage";

function fillerParagraph(index: number) {
  return `Background paragraph ${index} explains the study design, measurement strategy, and analytic decisions in enough detail to create a long document. `
    .repeat(4);
}

async function prepareLongDocument(page: Page) {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoApp(page);

  const text = [
    ...Array.from({ length: 10 }, (_, index) => fillerParagraph(index + 1)),
    `The introduction reaches ${LONG_TARGET} before describing the primary analysis.`,
    ...Array.from({ length: 10 }, (_, index) => fillerParagraph(index + 11)),
    `Later, the discussion returns to ${SECOND_TARGET} and its implications.`,
    ...Array.from({ length: 10 }, (_, index) => fillerParagraph(index + 21)),
  ].join("\n");
  await page.locator(".ProseMirror").fill(text);

  await page.route("**/api/review", async (route) => {
    const request = route.request().postDataJSON() as {
      revision: number;
      checksum: string;
      blocks: Array<{ id: string; text: string }>;
    };
    const firstBlock = request.blocks.find((block) => block.text.includes(LONG_TARGET));
    const secondBlock = request.blocks.find((block) => block.text.includes(SECOND_TARGET));
    if (!firstBlock || !secondBlock) {
      throw new Error("Long-document fixture did not preserve its review targets.");
    }

    const items: ReviewItem[] = [
      {
        id: "nav_first",
        documentRevision: request.revision,
        scope: {
          type: "range",
          blockId: firstBlock.id,
          original: LONG_TARGET,
          prefix: "The introduction reaches ",
          suffix: " before describing",
        },
        kind: "edit",
        category: "clarity",
        severity: "suggestion",
        title: "第一处局部定位",
        explanation: "用于验证长文中的原文定位。",
        replacement: LONG_TARGET,
        status: "open",
      },
      {
        id: "nav_second",
        documentRevision: request.revision,
        scope: {
          type: "range",
          blockId: secondBlock.id,
          original: SECOND_TARGET,
          prefix: "Later, the discussion returns to ",
          suffix: " and its implications",
        },
        kind: "edit",
        category: "clarity",
        severity: "suggestion",
        title: "第二处局部定位",
        explanation: "用于验证连续点击时旧滚动不会覆盖新目标。",
        replacement: SECOND_TARGET,
        status: "open",
      },
      {
        id: "nav_stale",
        documentRevision: request.revision,
        scope: {
          type: "range",
          blockId: firstBlock.id,
          original: "a passage that is absent from the document",
          prefix: "",
          suffix: "",
        },
        kind: "edit",
        category: "grammar",
        severity: "important",
        title: "无法定位的过期建议",
        explanation: "不得猜测原文位置。",
        replacement: "replacement",
        status: "stale",
      },
      {
        id: "nav_document",
        documentRevision: request.revision,
        scope: { type: "document" },
        kind: "opinion",
        category: "structure",
        severity: "suggestion",
        title: "全文建议保持摘要定位",
        explanation: "全文意见继续定位全文总结。",
        status: "open",
      },
    ];

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        documentSummary: "长文审阅摘要：用于验证全文建议定位。",
        items,
        documentRevision: request.revision,
        checksum: request.checksum,
      }),
    });
  });

  await page.getByRole("button", { name: "开始审阅" }).click();
  await expect(page.locator('[data-review-card="nav_first"]')).toBeVisible();
  await expect(page.locator('[data-review-card="nav_second"]')).toBeVisible();
}

async function expectTargetInReadableArea(page: Page, id: string) {
  const target = page.locator(`[data-review-id="${id}"]`).first();
  await expect(target).toBeVisible();
  await expect
    .poll(async () => {
      const targetBox = await target.boundingBox();
      const dockBox = await page.locator("[data-editor-dock]").boundingBox();
      return Boolean(
        targetBox &&
          dockBox &&
          targetBox.y >= 8 &&
          targetBox.y + targetBox.height <= dockBox.y - 8,
      );
    })
    .toBe(true);
}

test.describe("审阅建议与原文双向定位", () => {
  test("真人平滑滚动期间切换建议，旧目标不会覆盖新定位", async ({ page }) => {
    await prepareLongDocument(page);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => Object.defineProperty(navigator, "webdriver", {
      configurable: true,
      get: () => false,
    }));
    await scrollCardIntoView(page, "nav_first");
    await page.locator('[data-review-card="nav_first"]').click();
    // Trigger the next selection while the first document animation is running.
    await page.locator('[data-review-card="nav_second"]').evaluate((element) => {
      (element as HTMLElement).click();
    });
    await expectTargetInReadableArea(page, "nav_second");
    await expect(page.locator('[data-review-card="nav_second"]')).toHaveAttribute("aria-current", "true");
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
      .toBe(SECOND_TARGET);
  });

  test("展开和收起聊天时点击建议可定位，重复点击与快速切换使用最新目标", async ({ page }) => {
    await prepareLongDocument(page);
    const firstCard = page.locator('[data-review-card="nav_first"]');
    const secondCard = page.locator('[data-review-card="nav_second"]');

    await scrollCardIntoView(page, "nav_first");
    await firstCard.click();
    await expectTargetInReadableArea(page, "nav_first");
    await expect(page.getByLabel("上下文对话")).toContainText("当前上下文：建议");

    // 折叠聊天以提高正文可读空间，再点击同一建议验证重复点击仍重新执行定位。
    await page.getByRole("button", { name: "最小化聊天区" }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await scrollCardIntoView(page, "nav_first");
    await firstCard.click();
    await expectTargetInReadableArea(page, "nav_first");

    // 连续切换两条相距较远的建议，最后的选择和原文必须属于第二条。
    await scrollCardIntoView(page, "nav_first");
    await firstCard.click();
    await secondCard.click();
    await expect(secondCard).toHaveAttribute("aria-current", "true");
    await expect(firstCard).not.toHaveAttribute("aria-current", "true");
    await expect(page.locator(".ProseMirror")).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
      .toBe(SECOND_TARGET);
    await expectTargetInReadableArea(page, "nav_second");
  });

  test("正文点击仍对齐侧栏，全文建议定位摘要，stale 建议不会猜测位置", async ({ page }) => {
    await prepareLongDocument(page);
    const firstCard = page.locator('[data-review-card="nav_first"]');
    await scrollCardIntoView(page, "nav_first");
    await firstCard.click();
    await expectTargetInReadableArea(page, "nav_first");

    // 正文标记反向选中建议后，侧栏卡片与锚点仍保持中心对齐。
    await page.locator('[data-review-id="nav_first"]').first().click();
    await expect(firstCard).toHaveAttribute("aria-current", "true");
    await expect
      .poll(async () => {
        const [markBox, cardBox] = await Promise.all([
          page.locator('[data-review-id="nav_first"]').first().boundingBox(),
          firstCard.boundingBox(),
        ]);
        if (!markBox || !cardBox) return Number.POSITIVE_INFINITY;
        const markCenter = markBox.y + markBox.height / 2;
        const cardCenter = cardBox.y + cardBox.height / 2;
        return Math.abs(markCenter - cardCenter);
      })
      .toBeLessThan(48);

    const summary = page.getByText("长文审阅摘要：用于验证全文建议定位。");
    const documentCard = page.locator('[data-review-card="nav_document"]');
    await scrollCardIntoView(page, "nav_document");
    await documentCard.click();
    await expect(documentCard).toHaveAttribute("aria-current", "true");
    await expect(summary).toBeInViewport();

    const staleCard = page.locator('[data-review-card="nav_stale"]');
    await scrollCardIntoView(page, "nav_stale");
    const beforeScroll = await page.evaluate(() => window.scrollY);
    await staleCard.click();
    await expect(staleCard).toHaveAttribute("aria-current", "true");
    await expect(page.locator('[data-review-id="nav_stale"]')).toHaveCount(0);
    await expect(page.getByText("原文已变化，无法定位")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(beforeScroll);
  });
});
