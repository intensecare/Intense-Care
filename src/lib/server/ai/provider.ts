import { logger } from "@/lib/server/logger";

/**
 * AI provider client (server-only). The provider is Google's Gemini API, but
 * users only ever see "Intense AI": provider errors are logged here and
 * replaced with plain messages before anything reaches the browser.
 *
 * Env: GEMINI_API_KEY (required), GEMINI_MODEL (default gemini-2.5-flash),
 * GEMINI_API_BASE (optional, e.g. a proxy). The key never leaves the server.
 */

export interface Part {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}
export interface Content {
  role: "user" | "model";
  parts: Part[];
}

export class AiUnavailableError extends Error {
  constructor(public reason: "not_configured" | "provider_error" | "blocked" | "rate_limited" | "setup", message: string) {
    super(message);
  }
}

export function aiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

/**
 * One streamed model turn. Yields the parts of each streamed chunk as they
 * arrive (text deltas, function calls with their thought signatures).
 */
export async function* streamTurn(
  body: { systemInstruction: { parts: Part[] }; contents: Content[]; tools?: unknown[]; toolConfig?: unknown; generationConfig?: unknown },
  signal?: AbortSignal
): AsyncGenerator<Part[]> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new AiUnavailableError("not_configured", "Intense AI isn't set up yet. Ask your administrator to add the AI key.");
  const base = (process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  let res: Response;
  try {
    res = await fetch(`${base}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    logger.error("ai.provider.network_error", { error: err instanceof Error ? err.message : String(err) });
    throw new AiUnavailableError("provider_error", "Intense AI couldn't be reached. Please try again in a moment.");
  }
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    logger.error("ai.provider.http_error", { status: res.status, detail: detail.slice(0, 500) });
    if (res.status === 429) throw new AiUnavailableError("rate_limited", "Intense AI is busy or the AI plan's limit was reached. Please try again in a minute.");
    // Set-up problems an administrator can fix — say which one (never the provider's name).
    if (/API_KEY_INVALID|API key not valid|API_KEY_SERVICE_BLOCKED|SERVICE_DISABLED|PERMISSION_DENIED/i.test(detail) || res.status === 401 || res.status === 403) {
      throw new AiUnavailableError("setup", "Intense AI's key was not accepted. The administrator should check the AI key in the server's environment settings and that the AI API is enabled for that key.");
    }
    if (res.status === 404 || /is not found for API version|not supported for generateContent/i.test(detail)) {
      throw new AiUnavailableError("setup", "Intense AI's model setting is not available. The administrator should clear the AI model setting on the server (or set a current model).");
    }
    if (/location is not supported|FAILED_PRECONDITION/i.test(detail)) {
      throw new AiUnavailableError("setup", "Intense AI isn't available from this server's region. The administrator should host the app in a supported region.");
    }
    throw new AiUnavailableError("provider_error", "Intense AI couldn't answer right now. Please try again.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const json = line.slice(5).trim();
      if (!json || json === "[DONE]") continue;
      let chunk: { candidates?: { content?: { parts?: Part[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
      try {
        chunk = JSON.parse(json);
      } catch {
        continue;
      }
      if (chunk.promptFeedback?.blockReason) {
        throw new AiUnavailableError("blocked", "Intense AI can't help with that request. Try asking about your business data.");
      }
      const parts = chunk.candidates?.[0]?.content?.parts;
      if (parts?.length) yield parts;
    }
  }
}
