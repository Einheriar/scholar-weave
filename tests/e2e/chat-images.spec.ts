import { expect, test, type Page } from "@playwright/test";
import { gotoApp, loadSample, mockChatRoute, selectTextInEditor, sendChatMessage } from "./helpers";
import { ChatRequestSchema, type ChatRequest } from "../../src/lib/llm/chat-llm-schema";

async function toggleImageInput(page: Page) {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await dialog.getByRole("button", { name: "模型", exact: true }).click();
  await dialog.getByRole("switch", { name: "图片输入" }).click();
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await dialog.getByRole("button", { name: "关闭设置" }).click();
}

async function pasteImages(page: Page, names: string[]) {
  await page.getByLabel("对话输入框").evaluate((element, filenames) => {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    canvas.getContext("2d")!.fillRect(0, 0, 16, 16);
    const bytes = Uint8Array.from(atob(canvas.toDataURL().split(",")[1]), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    filenames.forEach((name) => transfer.items.add(new File([bytes], name, { type: "image/png" })));
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
  }, names);
}

test("pasted image survives reload and is included in follow-up history", async ({ page }) => {
  const requests: ChatRequest[] = [];
  await mockChatRoute(page, { onRequest: (body) => requests.push(ChatRequestSchema.parse(body)) });
  await gotoApp(page);
  await loadSample(page);
  await selectTextInEditor(page, "upstanding");
  await pasteImages(page, ["figure.png"]);
  await expect(page.getByRole("img", { name: "figure.png", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("这是纯解释回复（mock）")).toBeVisible();
  expect(requests[0].images).toHaveLength(1);
  await expect(page.getByText("已保存到本地", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("img", { name: "figure.png", exact: true })).toBeVisible();
  const viewImage = page.getByRole("button", { name: "查看图片：figure.png" });
  await viewImage.click();
  await expect(page.getByRole("dialog", { name: "图片预览：figure.png" })).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭图片预览" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "图片预览：figure.png" })).toHaveCount(0);
  await expect(viewImage).toBeFocused();
  await toggleImageInput(page);
  await pasteImages(page, ["disabled.png"]);
  await expect(page.locator("[data-chat-composer]").getByText("当前模型配置已关闭图片输入，请在设置中开启。")).toBeVisible();
  await expect(page.getByRole("img", { name: "disabled.png", exact: true })).toHaveCount(0);
  await page.getByLabel("对话输入框").fill("继续解释这张图");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("本次讨论包含图片，请先在模型设置中开启“图片输入”。草稿已保留。")).toBeVisible();
  await expect(page.getByLabel("对话输入框")).toHaveValue("继续解释这张图");
  expect(requests).toHaveLength(1);
  await toggleImageInput(page);
  await expect(page.locator("[data-chat-composer]").getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("对话输入框")).toHaveValue("继续解释这张图");
  await sendChatMessage(page, "继续解释这张图");
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].history.some((turn) => turn.images?.length === 1)).toBe(true);
});

test("paste and drop images can be removed before sending", async ({ page }) => {
  const requests: ChatRequest[] = [];
  await mockChatRoute(page, { onRequest: (body) => requests.push(ChatRequestSchema.parse(body)) });
  await gotoApp(page);
  await loadSample(page);
  await selectTextInEditor(page, "upstanding");
  const input = page.getByLabel("对话输入框");
  for (const eventType of ["paste", "drop"] as const) {
    await input.evaluate((element, type) => {
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext("2d")!;
      ctx.fillRect(0, 0, 16, 16);
      const bytes = Uint8Array.from(atob(canvas.toDataURL().split(",")[1]), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], `${type}.png`, { type: "image/png" }));
      element.dispatchEvent(type === "paste"
        ? new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer })
        : new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, eventType);
    await expect(page.getByRole("img", { name: `${eventType}.png`, exact: true })).toBeVisible();
  }
  await expect(page.locator("[data-chat-image-attachments] img")).toHaveCount(2);
  await toggleImageInput(page);
  await input.fill("解释这段文字");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("本次讨论包含图片，请先在模型设置中开启“图片输入”。草稿已保留。")).toBeVisible();
  await expect(page.locator("[data-chat-image-attachments] img")).toHaveCount(2);
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "移除图片：paste.png", exact: true }).click();
  await expect(page.getByRole("img", { name: "paste.png", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "移除图片：drop.png", exact: true }).click();
  await expect(page.locator("[data-chat-image-attachments] img")).toHaveCount(0);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].imageInputEnabled).toBe(false);
  expect(requests[0].images).toBeUndefined();
  await page.reload();
  await pasteImages(page, ["disabled.png"]);
  await expect(page.locator("[data-chat-composer]").getByText("当前模型配置已关闭图片输入，请在设置中开启。")).toBeVisible();
});

test("paste limit is shown inside the composer without a dedicated image button", async ({ page }) => {
  await gotoApp(page);
  await loadSample(page);
  const composer = page.locator("[data-chat-composer]");
  await expect(composer.getByRole("button", { name: "添加图片" })).toHaveCount(0);
  await expect(composer.locator('input[type="file"]')).toHaveCount(0);
  await expect(composer.locator("[data-chat-image-attachments]")).toHaveCount(0);
  await pasteImages(page, ["one.png", "two.png", "three.png", "four.png"]);
  await expect(composer.locator("img")).toHaveCount(4);
  await expect(composer.getByText("图片处理中…")).toHaveCount(0);
  await pasteImages(page, ["five.png"]);
  await expect(composer.getByRole("alert")).toHaveText("最多支持 4 张图片。");
  await expect(composer.locator("img")).toHaveCount(4);
  await expect(composer.getByRole("img", { name: "five.png" })).toHaveCount(0);
  await toggleImageInput(page);
  await toggleImageInput(page);
  await expect(composer.getByRole("alert")).toHaveText("最多支持 4 张图片。");
  await composer.getByRole("button", { name: "移除图片：one.png" }).click();
  await expect(composer.getByRole("alert")).toHaveCount(0);
  await pasteImages(page, ["five.png", "six.png"]);
  await expect(composer.getByRole("img", { name: "five.png" })).toBeVisible();
  await expect(composer.getByRole("img", { name: "six.png" })).toHaveCount(0);
  await expect(composer.getByRole("alert")).toHaveText("最多支持 4 张图片。");
  await expect(composer.locator("img")).toHaveCount(4);
});

test("enabling image input clears a paste validation error without another paste", async ({ page }) => {
  await gotoApp(page);
  await loadSample(page);
  const composer = page.locator("[data-chat-composer]");
  await toggleImageInput(page);
  await pasteImages(page, ["disabled.png"]);
  await expect(composer.getByRole("alert")).toHaveText("当前模型配置已关闭图片输入，请在设置中开启。");
  await toggleImageInput(page);
  await expect(composer.getByRole("alert")).toHaveCount(0);
  await expect(composer.locator("[data-chat-image-attachments]")).toHaveCount(0);
  await toggleImageInput(page);
  await expect(composer.getByRole("alert")).toHaveCount(0);
});
