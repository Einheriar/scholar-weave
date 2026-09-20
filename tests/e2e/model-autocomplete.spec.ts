import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

async function openModelSettings(page: Page) {
  await gotoApp(page);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await dialog.getByRole("button", { name: "模型", exact: true }).click();
  return dialog;
}

function modelInput(dialog: Locator) {
  return dialog.getByRole("combobox", { name: "模型", exact: true });
}

async function setProvider(dialog: Locator, baseURL: string) {
  await dialog
    .locator('input[placeholder="https://api.deepseek.com"]')
    .fill(baseURL);
  await dialog.locator('input[type="password"]').fill("test-api-key");
}

test.describe("模型名称联想", () => {
  test("按提供商模型列表本地筛选，并支持键盘选择、关闭和手动输入", async ({
    page,
  }) => {
    let calls = 0;
    await page.route("**/api/models", async (route) => {
      calls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          models: [
            "vendor/other-model",
            "meta/muse-spark-1.3",
            "spark-base",
            "provider/unsorted",
          ],
        }),
      });
    });

    const dialog = await openModelSettings(page);
    const input = modelInput(dialog);
    const listbox = page.getByRole("listbox", { name: "模型建议" });

    await input.focus();
    await expect.poll(() => calls).toBe(1);

    await input.fill("SPARK");
    await expect(listbox).toBeVisible();
    await expect
      .poll(() => listbox.getByRole("option").allTextContents())
      .toEqual(["spark-base", "meta/muse-spark-1.3"]);
    await expect.poll(() => calls).toBe(1);

    await input.press("ArrowDown");
    await input.press("Enter");
    await expect(input).toHaveValue("spark-base");
    await expect(listbox).toBeHidden();

    await input.click();
    await expect(listbox).toBeVisible();
    await input.press("Escape");
    await expect(listbox).toBeHidden();
    await expect(dialog).toBeVisible();

    await input.fill("provider/custom-model");
    await input.press("Escape");
    await expect(input).toHaveValue("provider/custom-model");
  });

  test("切换 Base URL 时丢弃旧的延迟模型列表", async ({ page }) => {
    let calls = 0;
    let releaseA!: () => void;
    let finishA!: () => void;
    const pendingA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const responseAFinished = new Promise<void>((resolve) => {
      finishA = resolve;
    });

    await page.route("**/api/models", async (route) => {
      calls += 1;
      const payload = route.request().postData() ?? "";
      if (payload.includes("provider-a.example")) {
        await pendingA;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ models: ["provider-a/old-model"] }),
        });
        finishA();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ models: ["provider-b/new-model"] }),
      });
    });

    const dialog = await openModelSettings(page);
    const input = modelInput(dialog);
    const listbox = page.getByRole("listbox", { name: "模型建议" });
    await setProvider(dialog, "https://provider-a.example/v1");
    await input.focus();
    await expect.poll(() => calls).toBe(1);

    await setProvider(dialog, "https://provider-b.example/v1");
    await input.focus();
    await expect.poll(() => calls).toBe(2);
    await input.fill("new-model");
    await expect(listbox.getByRole("option", { name: "provider-b/new-model" })).toBeVisible();

    releaseA();
    await responseAFinished;
    await expect(listbox.getByRole("option", { name: "provider-b/new-model" })).toBeVisible();
    await expect(listbox.getByRole("option", { name: "provider-a/old-model" })).toHaveCount(0);
  });

  test("获取模型列表失败时保留手动输入并支持重新获取", async ({ page }) => {
    let attempts = 0;
    await page.route("**/api/models", async (route) => {
      attempts += 1;
      if (attempts === 1) {
        await route.fulfill({
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "models_unavailable", message: "供应商不可用" },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ models: ["recovered/model"] }),
      });
    });

    const dialog = await openModelSettings(page);
    const input = modelInput(dialog);
    const listbox = page.getByRole("listbox", { name: "模型建议" });
    await input.fill("manual/model");
    await expect(page.getByText("无法获取模型列表，可手动输入模型名称。", { exact: true })).toBeVisible();
    const retryButton = page.getByRole("button", { name: "重新获取" });
    await expect(retryButton).toBeVisible();

    await input.fill("recovered");
    await retryButton.click();
    await expect(listbox.getByRole("option", { name: "recovered/model" })).toBeVisible();
    await expect(input).toHaveValue("recovered");
  });
});
