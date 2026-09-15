import { expect, test } from "@playwright/test";
import {
  gotoApp,
  mockChatRoute,
  paragraphTexts,
  sendChatMessage,
} from "./helpers";

/**
 * 左侧对话历史（ChatGPT 式）：
 * 宽屏常驻左栏、窄屏汉堡抽屉、发送后落库、刷新后恢复、切换/新对话/删除。
 *
 * 每个用例都是全新的 browser context（IndexedDB 为空），应用会载入样例。
 *
 * 定位约定：
 * - 宽屏常驻左栏是 `<aside>` → role=complementary；窄屏抽屉是 role=dialog；
 * - 历史条目用 [data-conversation-id]：条目按钮与它右上角的删除按钮可访问名里
 *   都含标题（删除按钮是「删除对话：<标题>」），按名字模糊匹配会同时命中两个；
 * - 「新对话」在历史栏与对话面板各有一个（同一动作，就近可达），按名字找会撞车，
 *   所以先 scope 到 `complementary` 或「上下文对话」这个 region 再找。
 */

/** 按标题取历史条目（只匹配条目按钮，不匹配它旁边的删除按钮） */
function historyItem(
  scope: import("@playwright/test").Page | import("@playwright/test").Locator,
  title: string,
) {
  return scope.locator("[data-conversation-id]").filter({ hasText: title });
}

test.describe("历史记录：宽屏常驻左栏", () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test("发送消息后左侧出现历史条目（标题取首条消息）", async ({ page }) => {
    await mockChatRoute(page, { withChanges: false });
    await gotoApp(page);

    const rail = page.getByRole("complementary", { name: "历史记录" });
    await expect(rail).toBeVisible();
    await expect(rail.getByText("还没有对话记录")).toBeVisible();

    await sendChatMessage(page, "第一条对话的标题");

    const item = historyItem(rail, "第一条对话的标题");
    await expect(item).toBeVisible();
    await expect(item).toHaveAttribute("aria-current", "true");
    // 轮次计数：用户 + 助手
    await expect(item).toContainText("2 条消息");
  });

  test("刷新后从 IndexedDB 恢复历史与当前对话", async ({ page }) => {
    await mockChatRoute(page, { withChanges: false });
    await gotoApp(page);
    await sendChatMessage(page, "请解释一下全文结构");

    await expect(page.getByText("这是纯解释回复（mock）")).toBeVisible();

    await page.reload();
    await expect(page.locator(".ProseMirror")).toBeVisible();

    // 历史条目回来了
    const rail = page.getByRole("complementary", { name: "历史记录" });
    await expect(historyItem(rail, "请解释一下全文结构")).toBeVisible();
    // 且自动接着最近这条对话继续（消息内容也回来了）
    await expect(page.getByText("这是纯解释回复（mock）")).toBeVisible();
  });

  test("新对话清空消息但保留历史，可点回去", async ({ page }) => {
    await mockChatRoute(page, { withChanges: false });
    await gotoApp(page);
    await sendChatMessage(page, "会被保存的对话");
    await expect(page.getByText("这是纯解释回复（mock）")).toBeVisible();

    const rail = page.getByRole("complementary", { name: "历史记录" });
    await rail.getByRole("button", { name: "新对话" }).click();

    // 当前消息清空
    await expect(page.getByText("这是纯解释回复（mock）")).toHaveCount(0);
    // 历史里那条还在，点回去能恢复消息
    const saved = historyItem(rail, "会被保存的对话");
    await expect(saved).toBeVisible();
    await saved.click();
    await expect(page.getByText("这是纯解释回复（mock）")).toBeVisible();
  });

  test("删除对话需确认，确认后从列表移除", async ({ page }) => {
    await mockChatRoute(page, { withChanges: false });
    await gotoApp(page);
    await sendChatMessage(page, "待删除的对话");

    const rail = page.getByRole("complementary", { name: "历史记录" });
    await expect(historyItem(rail, "待删除的对话")).toBeVisible();

    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "删除对话：待删除的对话" }).click();

    await expect(historyItem(rail, "待删除的对话")).toHaveCount(0);
    await expect(rail.getByText("还没有对话记录")).toBeVisible();
  });

  test("历史栏不遮挡编辑器，且聊天不改正文", async ({ page }) => {
    await mockChatRoute(page, { withChanges: false });
    await gotoApp(page);

    const before = await paragraphTexts(page);
    await sendChatMessage(page, "只聊天不改正文");
    await expect(page.getByText("这是纯解释回复（mock）")).toBeVisible();

    // 编辑器仍在文档流里、可见，且整体位于历史栏右侧（没有被压住/重叠）
    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeVisible();
    const railBox = await page
      .getByRole("complementary", { name: "历史记录" })
      .boundingBox();
    const editorBox = await editor.boundingBox();
    expect(railBox).not.toBeNull();
    expect(editorBox).not.toBeNull();
    expect(editorBox!.x).toBeGreaterThanOrEqual(railBox!.x + railBox!.width);

    // 对话历史不碰正文
    expect(await paragraphTexts(page)).toEqual(before);
  });
});

test.describe("历史记录：窄屏抽屉", () => {
  test.use({ viewport: { width: 700, height: 800 } });

  test("常驻左栏隐藏，汉堡按钮拉出抽屉，选完自动收起", async ({ page }) => {
    await mockChatRoute(page, { withChanges: false });
    await gotoApp(page);

    // 窄屏没有常驻左栏
    await expect(page.getByRole("complementary", { name: "历史记录" })).toHaveCount(0);

    const toggle = page.getByRole("button", { name: "历史记录" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await sendChatMessage(page, "窄屏下的对话");
    await expect(page.getByText("这是纯解释回复（mock）")).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const drawer = page.getByRole("dialog", { name: "历史记录" });
    await expect(drawer).toBeVisible();

    await historyItem(drawer, "窄屏下的对话").click();
    await expect(drawer).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("抽屉里的新对话也能用", async ({ page }) => {
    await mockChatRoute(page, { withChanges: false });
    await gotoApp(page);
    await sendChatMessage(page, "抽屉里的对话");
    await expect(page.getByText("这是纯解释回复（mock）")).toBeVisible();

    await page.getByRole("button", { name: "历史记录" }).click();
    const drawer = page.getByRole("dialog", { name: "历史记录" });
    await drawer.getByRole("button", { name: "新对话" }).click();

    await expect(drawer).toHaveCount(0);
    await expect(page.getByText("这是纯解释回复（mock）")).toHaveCount(0);
  });

  test("Escape 关闭抽屉", async ({ page }) => {
    await gotoApp(page);
    const toggle = page.getByRole("button", { name: "历史记录" });
    await toggle.click();
    const drawer = page.getByRole("dialog", { name: "历史记录" });
    await expect(drawer).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
  });
});
