import {
  ChatImageSchema,
  MAX_CHAT_IMAGE_BYTES,
  type ChatImage,
} from "@/lib/review-schema";

/** Source files may be larger; they are decoded and compressed in the browser. */
export const MAX_CHAT_SOURCE_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_CHAT_IMAGE_EDGE = 1600;
export const SUPPORTED_CHAT_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export function isSupportedChatImage(file: File): boolean {
  return SUPPORTED_CHAT_IMAGE_TYPES.includes(
    file.type as (typeof SUPPORTED_CHAT_IMAGE_TYPES)[number],
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("无法读取图片。"));
    };
    reader.onerror = () => reject(new Error("无法读取图片。"));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法解析图片。"));
    image.src = dataUrl;
  });
}

function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  const payload = dataUrl.slice(comma + 1);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

function makeImageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `chat_image_${crypto.randomUUID()}`;
  }
  return `chat_image_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Decode and compress a local image for the chat protocol. The result is a
 * self-contained data URL and is never uploaded anywhere by this utility.
 */
export async function processChatImageFile(file: File): Promise<ChatImage> {
  if (!isSupportedChatImage(file)) {
    throw new Error("仅支持 PNG、JPEG 和 WebP 图片。");
  }
  if (file.size <= 0 || file.size > MAX_CHAT_SOURCE_IMAGE_BYTES) {
    throw new Error("图片原文件不能超过 10MB。");
  }

  const source = await fileToDataUrl(file);
  const image = await loadImage(source);
  const scale = Math.min(
    1,
    MAX_CHAT_IMAGE_EDGE / Math.max(image.naturalWidth || image.width, 1),
    MAX_CHAT_IMAGE_EDGE / Math.max(image.naturalHeight || image.height, 1),
  );
  const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法处理图片。");
  context.drawImage(image, 0, 0, width, height);

  // WebP is compact and supported by the browsers this app targets. Fall
  // back to JPEG when a browser does not expose WebP encoding.
  const webpProbe = canvas.toDataURL("image/webp", 0.82);
  const outputType = webpProbe.startsWith("data:image/webp")
    ? "image/webp"
    : "image/jpeg";
  const qualities = [0.82, 0.7, 0.58, 0.45, 0.32];
  let output = "";
  for (const quality of qualities) {
    output = canvas.toDataURL(outputType, quality);
    if (dataUrlBytes(output) <= MAX_CHAT_IMAGE_BYTES) break;
  }
  if (dataUrlBytes(output) > MAX_CHAT_IMAGE_BYTES) {
    throw new Error("图片压缩后仍超过 2MB，请选择更小的图片。");
  }

  return ChatImageSchema.parse({
    id: makeImageId(),
    name: (file.name || "图片").slice(0, 200),
    dataUrl: output,
  });
}
