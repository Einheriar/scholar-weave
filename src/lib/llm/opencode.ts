/** Internal transport metadata, separate from the JSON and prompt protocols. */
export const CHAT_SESSION_HEADER = "x-scholarweave-session";

/** Match the official host and API path boundaries, never names or query values. */
export function isOpenCodeEndpoint(baseURL: string): boolean {
  let url: URL;
  try {
    url = new URL(baseURL);
  } catch {
    return false;
  }
  return url.hostname === "opencode.ai" &&
    ["https:", "http:"].includes(url.protocol) &&
    /^\/(?:inference|zen)(?:\/|$)/.test(url.pathname);
}

/** Only official OpenCode API paths receive the provider-specific session header. */
export function openCodeSessionId(baseURL: string, sessionId?: string): string | undefined {
  if (!isOpenCodeEndpoint(baseURL)) return undefined;

  // Node IDs are persisted with the conversation. Standalone requests get their
  // own ID, retained by the provider across structured-output retries.
  const id = sessionId && /^[A-Za-z0-9_-]{1,128}$/.test(sessionId)
    ? sessionId
    : crypto.randomUUID();
  return id.startsWith("ses_") ? id : `ses_${id}`;
}
