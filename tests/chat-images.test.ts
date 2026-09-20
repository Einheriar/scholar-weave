import { describe, expect, it } from "vitest";
import {
  ChatImageSchema,
  ChatImagesSchema,
  ChatTurnSchema,
  MAX_CHAT_IMAGE_BYTES,
} from "@/lib/review-schema";
import { ChatRequestSchema } from "@/lib/llm/chat-llm-schema";

function image(
  id = "img-1",
  bytes = 3,
  mime: "png" | "jpeg" | "webp" = "png",
) {
  const payload = Buffer.alloc(bytes).toString("base64");
  return { id, name: `${id}.${mime}`, dataUrl: `data:image/${mime};base64,${payload}` };
}

describe("chat image schema", () => {
  it.each([
    "https://example.com/image.png",
    "data:text/plain;base64,AAAA",
    "data:image/png;base64,!!!!",
    "data:image/png;base64,AAAA=",
  ])("拒绝非法图片 data URL：%s", (dataUrl) => {
    expect(ChatImageSchema.safeParse({ id: "bad", name: "bad.png", dataUrl }).success).toBe(false);
  });

  it("拒绝超过 2MiB 的单张图片", () => {
    expect(
      ChatImageSchema.safeParse(image("large", MAX_CHAT_IMAGE_BYTES + 1)).success,
    ).toBe(false);
  });

  it("每个消息最多携带 4 张图片", () => {
    expect(ChatImagesSchema.safeParse([
      image("1"), image("2"), image("3"), image("4"), image("5"),
    ]).success).toBe(false);
  });

  it("只允许 user 轮次携带图片，旧的纯文本 turn 仍可读取", () => {
    expect(ChatTurnSchema.parse({ role: "user", content: "旧消息" })).toMatchObject({
      role: "user",
      content: "旧消息",
    });
    expect(ChatTurnSchema.parse({ role: "user", content: "看图", images: [image()] }).images).toHaveLength(1);
    expect(ChatTurnSchema.safeParse({ role: "assistant", content: "回复", images: [image()] }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({
      documentId: "doc_1", revision: 1, checksum: "c",
      context: { type: "document" }, message: "继续",
      history: [{ role: "assistant", content: "旧回复", images: [image()] }],
      blocks: [],
    }).success).toBe(false);
  });
});
