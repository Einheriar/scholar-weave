/** Internal transport metadata, separate from the JSON and prompt protocols. */
export const CHAT_SESSION_HEADER = "x-scholarweave-session";

/** Only official OpenCode API paths receive the provider-specific session header. */
export function openCodeSessionId(baseURL: string, sessionId?: string): string | undefined {
  let url: URL;
  try {
    url = new URL(baseURL);
  } catch {
    return undefined;
  }
  if (
    url.hostname !== "opencode.ai" ||
    !["https:", "http:"].includes(url.protocol) ||
    !/^\/(?:inference|zen)(?:\/|$)/.test(url.pathname)
  ) {
    return undefined;
  }

  // Node IDs are persisted with the conversation. Standalone requests get their
  // own ID, retained by the provider across structured-output retries.
  const id = sessionId && /^[A-Za-z0-9_-]{1,128}$/.test(sessionId)
    ? sessionId
    : crypto.randomUUID();
  return id.startsWith("ses_") ? id : `ses_${id}`;
}
