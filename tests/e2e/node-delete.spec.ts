import { expect, test } from "@playwright/test";
import { gotoApp, loadSample, mockChatRoute, selectTextInEditor, sendChatMessage } from "./helpers";

test("delete local nodes from the minimized chat timeline", async ({ page }) => {
  await mockChatRoute(page);
  await gotoApp(page);
  await loadSample(page);
  for (const text of ["upstanding", "overlooking the interpersonal part"]) {
    await selectTextInEditor(page, text);
    await sendChatMessage(page, `Discuss ${text}`);
    await expect(page.getByText("这是纯解释回复（mock）")).toBeVisible();
  }
  await page.getByRole("button", { name: "最小化聊天区" }).click();
  await page.getByRole("button", { name: "聊天节点历史" }).click();
  const timeline = page.getByRole("dialog", { name: "聊天节点历史" });
  const deletes = timeline.getByRole("button", { name: "删除该节点讨论" });
  await expect(deletes).toHaveCount(2);
  await deletes.first().click();
  await expect(deletes).toHaveCount(1);
  await deletes.first().click();
  await expect(deletes).toHaveCount(0);
});

test("node deletion explains the request lock and recovers after the reply", async ({ page }) => {
  await mockChatRoute(page);
  await gotoApp(page);
  await loadSample(page);
  await selectTextInEditor(page, "upstanding");
  await sendChatMessage(page, "First question");
  await expect(page.getByText("这是纯解释回复（mock）")).toBeVisible();

  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/chat", async (route) => {
    await pending;
    await route.fallback();
  });
  await sendChatMessage(page, "Follow-up question");
  await page.getByRole("button", { name: "最小化聊天区" }).click();
  await page.getByRole("button", { name: "聊天节点历史" }).click();
  const timeline = page.getByRole("dialog", { name: "聊天节点历史" });
  const remove = timeline.getByRole("button", { name: "删除该节点讨论" });
  await expect(remove).toBeDisabled();
  await remove.hover();
  await expect(page.getByRole("tooltip", { name: "请求处理中，暂不能删除节点" })).toBeVisible();
  // aria-disabled preserves focus so keyboard users can discover the explanation.
  await remove.focus();
  await page.keyboard.press("Enter");
  await expect(remove).toHaveCount(1);
  release();
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect(remove).toHaveCount(0);
  await expect(page.getByText("已保存到本地", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "聊天节点历史" }).click();
  await expect(page.getByRole("button", { name: "删除该节点讨论" })).toHaveCount(0);
});
