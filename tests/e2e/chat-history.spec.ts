import { expect, test } from "@playwright/test";
import {
  gotoApp,
  loadSample,
  mockChatRoute,
  selectTextInEditor,
  sendChatMessage,
} from "./helpers";

/**
 * 左侧历史记录（项目列表）：一项 = 一篇文章的完整工作现场。
 * 宽屏常驻左栏、窄屏汉堡抽屉、发送后建档、刷新恢复、切换/新文章/删除。
 *
 * 每个用例都是全新的 browser context（IndexedDB 为空），应用会载入样例。
 *
 * 定位约定：
 * - 宽屏常驻左栏是 `<aside>` → role=complementary；窄屏抽屉是 role=dialog；
 * - 历史条目用 [data-project-id]：条目按钮与它右上角的删除按钮可访问名里
 *   都含标题（删除按钮是「删除文章：<标题>」），按名字模糊匹配会同时命中两个；
 * - 「新文章」在历史栏里，按名字找可能撞车，先 scope 到 complementary 再找。
 */

/** 按标题取历史条目（只匹配条目按钮，不匹配它旁边的删除按钮） */
function historyItem(
  scope: import("@playwright/test").Page | import("@playwright/test").Locator,
  title: string,
) {
  return scope.locator("[data-project-id]").filter({ hasText: title });
}

/** 样例文档标题（项目标题派生源：deriveProjectTitle 优先取文档标题） */
const SAMPLE_TITLE = "The Role of Receiver's Social Category in Deception";

test.describe("历史记录（项目）：宽屏常驻左栏", () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test("顶栏操作组以正文栏为中心，宽屏不重复展示待处理计数", async ({ page }) => {
    await gotoApp(page);
    await loadSample(page);

    const operations = page.getByRole("group", { name: "文档操作" });
    const editor = page.locator(".ProseMirror");
    const title = page.getByLabel("文档标题");
    const [operationsBox, editorBox, titleBox] = await Promise.all([
      operations.boundingBox(),
      editor.boundingBox(),
      title.boundingBox(),
    ]);
    expect(operationsBox).not.toBeNull();
    expect(editorBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    const operationsCenter = operationsBox!.x + operationsBox!.width / 2;
    const editorCenter = editorBox!.x + editorBox!.width / 2;
    expect(Math.abs(operationsCenter - editorCenter)).toBeLessThanOrEqual(1);
    // 标题不是固定宽度：自适应铺到操作组左侧，并保留 12px 间距。
    expect(Math.abs(operationsBox!.x - (titleBox!.x + titleBox!.width) - 12)).toBeLessThanOrEqual(1);

    await expect(page.locator("header").getByText(/条待处理/)).toBeHidden();
    await expect(
      page
        .getByRole("complementary", { name: "审阅建议侧栏" })
        .getByText(/待处理 \/ 共/),
    ).toBeVisible();
  });

  test("发送消息后建档，左侧出现该文章条目（标题取正文首段）", async ({ page }) => {
    await mockChatRoute(page, { withChanges: false });
    await gotoApp(page);
    await loadSample(page);

    const rail = page.getByRole("complementary", { name: "历史记录" });
    // 载入样例即建档（首次审阅/发消息即保存，规则 1）；样例项目标题 = 首段
    const item = historyItem(rail, SAMPLE_TITLE);
    await expect(item).toBeVisible();
    await expect(item).toHaveAttribute("aria-current", "true");
    await expect(item).toContainText("最近活动：");
  });

  test("规则 11：无选区禁止提问（发送被禁用）", async ({ page }) => {
    await mockChatRoute(page, { withChanges: false });
    await gotoApp(page);
    await loadSample(page);

    // 不选任何文字：输入框有内容但发送按钮仍禁用
    const box = page.getByLabel("对话输入框");
    await box.fill("没有选区的问题");
    const send = page.getByRole("button", { name: "发送", exact: true });
    await expect(send).toBeDisabled();
  });

  test("选词提问后建档；同词再提追加到同一节点", async ({ page }) => {
    await mockChatRoute(page, { withChanges: false });
    await gotoApp(page);
    await loadSample(page);
    await selectTextInEditor(page, "upstanding");
    await sendChatMessage(page, "这个词什么意思");

    await expect(page.getByText("这是纯解释回复（mock）")).toBeVisible();
    // 项目已建档
    const rail = page.getByRole("complementary", { name: "历史记录" });
    await expect(historyItem(rail, SAMPLE_TITLE)).toBeVisible();

    // 同词再提：节点追加（仍只有一个节点 → 时间线一行两问）
    await selectTextInEditor(page, "upstanding");
    await sendChatMessage(page, "能再举个例子吗");
    await expect(page.getByText("这是纯解释回复（mock）")).toHaveCount(2);
  });

  test("刷新后从 IndexedDB 恢复项目现场（正文 + 聊天节点）", async ({ page }) => {
    await mockChatRoute(page, { withChanges: false });
    await gotoApp(page);
    await loadSample(page);
    await selectTextInEditor(page, "upstanding");
    await sendChatMessage(page, "刷新后还在吗");

    await expect(page.getByText("这是纯解释回复（mock）")).toBeVisible();
    // 等保存状态落定（回复到达会立即落库），否则 reload 读到的可能是旧档
    await expect(page.getByRole("status").first()).toContainText("已保存到本地");

    await page.reload();
    await expect(page.locator(".ProseMirror")).toBeVisible();

    // 项目条目回来了，且聊天现场也回来了
    const rail = page.getByRole("complementary", { name: "历史记录" });
    await expect(historyItem(rail, SAMPLE_TITLE)).toBeVisible();
    await expect(page.getByText("这是纯解释回复（mock）")).toBeVisible();
  });

  test("新文章清空现场但旧文章留在左栏，可点回去", async ({ page }) => {
    await mockChatRoute(page, { withChanges: false });
    await gotoApp(page);
    await loadSample(page);
    await selectTextInEditor(page, "upstanding");
    await sendChatMessage(page, "会被保存的讨论");
    await expect(page.getByText("这是纯解释回复（mock）")).toBeVisible();

    const rail = page.getByRole("complementary", { name: "历史记录" });
    await rail.getByRole("button", { name: "新文章" }).click();

    // 聊天清空、正文清空（新文章是空文档）
    await expect(page.getByText("这是纯解释回复（mock）")).toHaveCount(0);
    // 历史里那条还在，点回去能恢复正文 + 聊天
    const saved = historyItem(rail, SAMPLE_TITLE);
    await expect(saved).toBeVisible();
    await saved.click();
    await expect(page.getByText("这是纯解释回复（mock）")).toBeVisible();
  });

  test("删除文章需确认，确认后从列表移除", async ({ page }) => {
    await mockChatRoute(page, { withChanges: false });
    await gotoApp(page);
    await loadSample(page);

    const rail = page.getByRole("complementary", { name: "历史记录" });
    await expect(historyItem(rail, SAMPLE_TITLE)).toBeVisible();

    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: `删除文章：${SAMPLE_TITLE}` }).click();

    await expect(historyItem(rail, SAMPLE_TITLE)).toHaveCount(0);
  });
});

test.describe("顶栏：中窄屏自适应", () => {
  test.use({ viewport: { width: 900, height: 800 } });

  test("优先压缩标题，清空项目按钮不越出顶栏右边界", async ({ page }) => {
    await gotoApp(page);

    const headerBox = await page.locator("header").boundingBox();
    const titleBox = await page.getByLabel("文档标题").boundingBox();
    const clearBox = await page.getByRole("button", { name: "清空项目" }).boundingBox();
    expect(headerBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect(clearBox).not.toBeNull();
    expect(titleBox!.width).toBeLessThan(288);
    expect(clearBox!.x + clearBox!.width).toBeLessThanOrEqual(
      headerBox!.x + headerBox!.width + 1,
    );
  });
});

test.describe("历史记录（项目）：窄屏抽屉", () => {
  test.use({ viewport: { width: 700, height: 800 } });

  test("常驻左栏隐藏，汉堡按钮拉出抽屉，选完自动收起", async ({ page }) => {
    await mockChatRoute(page, { withChanges: false });
    await gotoApp(page);
    await loadSample(page);

    // 窄屏没有常驻左栏
    await expect(page.getByRole("complementary", { name: "历史记录" })).toHaveCount(0);

    const toggle = page.getByRole("button", { name: "历史记录" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const drawer = page.getByRole("dialog", { name: "历史记录" });
    await expect(drawer).toBeVisible();
    await expect(historyItem(drawer, SAMPLE_TITLE)).toBeVisible();

    await historyItem(drawer, SAMPLE_TITLE).click();
    await expect(drawer).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
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
