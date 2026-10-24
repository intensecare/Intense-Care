import Groq from "groq-sdk";
import { logger } from "@/lib/server/logger";

/**
 * AI provider client (server-only) — Groq's chat completions API via the official `groq-sdk`.
 * Users only ever see "Intense AI": provider errors are logged here and replaced with plain
 * messages before anything reaches the browser.
 *
 * Env: GROQ_API_KEY (required), GROQ_MODEL (default openai/gpt-oss-120b — verified live against
 * Groq's /openai/v1/models before choosing it; Groq retires models over time, so re-check that
 * list if this one stops working rather than guessing a new one), GROQ_API_BASE (optional, e.g.
 * a proxy — the bare root, like the default https://api.groq.com; the SDK appends /openai/v1/...
 * itself). The key never leaves the server.
 *
 * This is the ONLY file that knows Groq's wire format. Everything else in src/lib/server/ai
 * works with the provider-agnostic Msg/ToolDecl/StreamEvent shapes below — swapping providers
 * again later should only ever touch this file.
 */

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}
export type Msg =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface ToolSchema {
  type: string;
  description?: string;
  enum?: string[];
  properties?: Record<string, ToolSchema>;
  items?: ToolSchema;
  required?: string[];
}
export interface ToolDecl {
  name: string;
  description: string;
  parameters?: ToolSchema;
}

export interface StreamEvent {
  /** User-visible answer text (reasoning_format: "hidden" means the model's chain of thought is never sent to us at all). */
  text?: string;
  /** Present once, when the model finishes a turn by requesting tool calls instead of answering. */
  toolCalls?: ToolCall[];
}

export class AiUnavailableError extends Error {
  constructor(public reason: "not_configured" | "provider_error" | "blocked" | "rate_limited" | "setup", message: string) {
    super(message);
  }
}

export function aiConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

const REQUEST_TIMEOUT_MS = 60_000;

/** Our tool schema uses Gemini-era uppercase JSON-schema-ish types; Groq/OpenAI need lowercase. */
function convertSchema(s: ToolSchema): Record<string, unknown> {
  const out: Record<string, unknown> = { type: s.type.toLowerCase() };
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum;
  if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, convertSchema(v)]));
  if (s.items) out.items = convertSchema(s.items);
  if (s.required) out.required = s.required;
  return out;
}

function toGroqTools(tools: ToolDecl[]): Groq.Chat.Completions.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters ? convertSchema(t.parameters) : { type: "object", properties: {} },
    },
  }));
}

function toGroqMessages(messages: Msg[]): Groq.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((m) => {
    if (m.role === "assistant") {
      return {
        role: "assistant",
        content: m.content,
        ...(m.toolCalls?.length
          ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
          : {}),
      };
    }
    if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
    return { role: m.role, content: m.content };
  });
}

let client: Groq | null = null;
function groq(): Groq {
  if (client) return client;
  client = new Groq({
    apiKey: process.env.GROQ_API_KEY?.trim(),
    baseURL: process.env.GROQ_API_BASE?.trim() || undefined,
    timeout: REQUEST_TIMEOUT_MS,
  });
  return client;
}

/** The model-setup-problem admin messages, keyed by what went wrong — never the provider's name. */
function setupMessage(detail: string): string {
  return `Intense AI's ${detail}. The administrator should check the AI key and model setting in the server's environment settings.`;
}

/**
 * One streamed model turn. Yields user-visible text deltas as they arrive, then (at most once)
 * the tool calls the model asked for, fully assembled — Groq streams a tool call's JSON
 * arguments in fragments across several chunks, keyed by index, so they're accumulated here
 * rather than yielded piecemeal.
 */
export async function* streamTurn(
  messages: Msg[],
  tools: ToolDecl[],
  opts: { forceAnswer?: boolean } = {},
  signal?: AbortSignal
): AsyncGenerator<StreamEvent> {
  if (!aiConfigured()) throw new AiUnavailableError("not_configured", "Intense AI isn't set up yet. Ask your administrator to add the AI key.");
  const model = process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";

  let stream: AsyncIterable<Groq.Chat.Completions.ChatCompletionChunk>;
  try {
    stream = await groq().chat.completions.create(
      {
        model,
        stream: true,
        messages: toGroqMessages(messages),
        temperature: 0.3,
        max_completion_tokens: 8192,
        // gpt-oss models always reason a little even at "low" — hidden so it's never shown, and
        // capped the same way the previous Gemini integration capped its thinking budget.
        reasoning_effort: "low",
        reasoning_format: "hidden",
        ...(opts.forceAnswer ? { tool_choice: "none" as const } : tools.length ? { tools: toGroqTools(tools) } : {}),
      },
      { signal }
    );
  } catch (err) {
    if (signal?.aborted) throw err; // the caller disconnected or pressed Stop — nothing to report
    if (err instanceof Groq.APIUserAbortError) throw err;
    if (err instanceof Groq.APIConnectionTimeoutError) throw new AiUnavailableError("provider_error", "Intense AI took too long to respond. Please try again.");
    if (err instanceof Groq.RateLimitError) throw new AiUnavailableError("rate_limited", "Intense AI is busy or the AI plan's limit was reached. Please try again in a minute.");
    if (err instanceof Groq.AuthenticationError || err instanceof Groq.PermissionDeniedError) throw new AiUnavailableError("setup", setupMessage("key was not accepted"));
    if (err instanceof Groq.NotFoundError) throw new AiUnavailableError("setup", setupMessage("model setting is not available"));
    if (err instanceof Groq.APIConnectionError) {
      logger.error("ai.provider.network_error", { error: err.message });
      throw new AiUnavailableError("provider_error", "Intense AI couldn't be reached. Please try again in a moment.");
    }
    if (err instanceof Groq.InternalServerError) throw new AiUnavailableError("provider_error", "Intense AI's provider is temporarily unavailable. Please try again shortly.");
    if (err instanceof Groq.APIError) {
      logger.error("ai.provider.http_error", { status: err.status, message: err.message.slice(0, 500) });
      throw new AiUnavailableError("provider_error", "Intense AI couldn't answer right now. Please try again.");
    }
    logger.error("ai.provider.unknown_error", { error: err instanceof Error ? err.message : String(err) });
    throw new AiUnavailableError("provider_error", "Intense AI couldn't answer right now. Please try again.");
  }

  const callAcc = new Map<number, { id: string; name: string; args: string }>();
  try {
    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string" && delta.content.length) {
        yield { text: delta.content };
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const cur = callAcc.get(idx) ?? { id: "", name: "", args: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          callAcc.set(idx, cur);
        }
      }
      if (choice.finish_reason === "tool_calls") {
        const calls: ToolCall[] = Array.from(callAcc.values()).map((c) => {
          let args: Record<string, unknown> = {};
          try {
            args = c.args ? JSON.parse(c.args) : {};
          } catch {
            args = {};
          }
          return { id: c.id, name: c.name, args };
        });
        yield { toolCalls: calls };
        callAcc.clear();
      }
    }
  } catch (err) {
    if (signal?.aborted || err instanceof Groq.APIUserAbortError) throw err;
    if (err instanceof Groq.APIConnectionTimeoutError) throw new AiUnavailableError("provider_error", "Intense AI took too long to respond. Please try again.");
    logger.error("ai.provider.stream_error", { error: err instanceof Error ? err.message : String(err) });
    throw new AiUnavailableError("provider_error", "Intense AI couldn't answer right now. Please try again.");
  }
}
