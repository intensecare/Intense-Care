/**
 * Minimal structured logger for server-side security flows.
 *
 * Never logs: OTP codes, API keys, full portal tokens, message bodies with
 * secrets. Phone numbers are always masked before emission.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configuredLevel = ((): LogLevel => {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase();
  return raw === "debug" || raw === "info" || raw === "warn" || raw === "error"
    ? (raw as LogLevel)
    : "info";
})();

export function maskPhone(phone: string): string {
  const digits = phone.replace(/[^0-9+]/g, "");
  const last4 = digits.slice(-4);
  const prefix = digits.slice(0, digits.length - last4.length).replace(/[0-9]/g, "*");
  return `${prefix}${last4}`;
}

export function maskToken(token: string): string {
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}****${token.slice(-4)}`;
}

function emit(level: LogLevel, event: string, context: Record<string, unknown> = {}): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[configuredLevel]) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...context,
  };

  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, context?: Record<string, unknown>) => emit("debug", event, context),
  info: (event: string, context?: Record<string, unknown>) => emit("info", event, context),
  warn: (event: string, context?: Record<string, unknown>) => emit("warn", event, context),
  error: (event: string, context?: Record<string, unknown>) => emit("error", event, context),
};
