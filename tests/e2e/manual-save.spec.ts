import { expect, test } from "@playwright/test";
import { gotoApp } from "./helpers";

test("save button persists the current article without a model request", async ({ page }) => {
  await gotoApp(page);
  const save = page.getByRole("button", { name: "保存到本地", exact: true });
  await expect(save).toBeVisible();
  await save.click();
  await expect(page.getByText("已保存到本地", { exact: true })).toBeVisible();
  await expect(save).toHaveAttribute("aria-busy", "false");
  const title = await page.getByLabel("文档标题").inputValue();
  expect(title.length).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByLabel("文档标题")).toHaveValue(title);
});
