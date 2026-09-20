/** Extract model IDs from common OpenAI-compatible list response shapes. */
export function normalizeModelIds(payload: unknown): string[] {
  let entries: unknown[] | undefined;
  if (Array.isArray(payload)) {
    entries = payload;
  } else if (payload && typeof payload === "object") {
    const record = payload as { data?: unknown; models?: unknown };
    if (Array.isArray(record.data)) entries = record.data;
    else if (Array.isArray(record.models)) entries = record.models;
  }
  if (!entries) throw new Error("invalid_model_list");

  const ids = entries
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object" && "id" in entry) {
        const id = (entry as { id?: unknown }).id;
        return typeof id === "string" ? id : null;
      }
      return null;
    })
    .map((id) => (typeof id === "string" ? id.trim() : ""))
    .filter(
      (id) =>
        id.length > 0 &&
        id.length <= 512 &&
        !/[\u0000-\u001f\u007f]/.test(id),
    );

  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}
