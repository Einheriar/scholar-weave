"use client";

import type { ChatImage } from "@/lib/review-schema";

export type ChatImageAttachmentsProps = {
  images: ChatImage[];
  pending: boolean;
  error: string | null;
  disabled?: boolean;
  onRemove: (id: string) => void;
};

/** Local-only image attachment controls for the chat composer. */
export function ChatImageAttachments({
  images,
  pending,
  error,
  disabled = false,
  onRemove,
}: ChatImageAttachmentsProps) {
  if (!images.length && !pending && !error) return null;

  return (
    <div
      data-chat-image-attachments
      className="min-w-0 px-2.5 pb-1"
    >
      {images.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2" aria-label="待发送图片">
          {images.map((image) => (
            <div
              key={image.id}
              className="group relative h-14 w-14 overflow-hidden rounded-lg border border-border bg-surface-muted"
            >
              {/* This is a local data URL preview; next/image cannot optimize it. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.dataUrl}
                alt={image.name}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                aria-label={`移除图片：${image.name}`}
                disabled={disabled || pending}
                onClick={() => onRemove(image.id)}
                className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface/90 text-xs leading-none text-text-muted opacity-0 transition-[opacity,color] group-hover:opacity-100 hover:text-red-600 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring disabled:cursor-not-allowed dark:hover:text-red-400"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {pending && <p role="status" className="px-2 text-xs text-text-muted">图片处理中…</p>}
      {error && <p role="alert" className="mt-1 px-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
