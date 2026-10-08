import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { logger } from "./logger";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Handler<C> = (request: Request, context: C) => Promise<unknown>;

/**
 * Wraps a route handler: returns `{ ok: true, data }` on success and
 * `{ ok: false, error }` with the right status on failure. Unexpected errors
 * are logged and returned as a generic 500 (no internals leak).
 */
export function api<C = { params: Record<string, string> }>(fn: Handler<C>) {
  return async (request: Request, context: C) => {
    try {
      const data = await fn(request, context);
      return NextResponse.json({ ok: true, data: data ?? null });
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return NextResponse.json({ ok: false, error: "A record with these details already exists." }, { status: 409 });
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
        return NextResponse.json({ ok: false, error: "Record not found." }, { status: 404 });
      }
      logger.error("api.unhandled", { url: request.url, error: err instanceof Error ? err.message : String(err) });
      return NextResponse.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
    }
  };
}

/** Parses a JSON body against a zod schema; throws 400 with the first issue. */
export async function body<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.infer<T>> {
  const raw = await request.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
    throw new HttpError(400, `${field}${issue?.message ?? "Invalid request."}`);
  }
  return parsed.data;
}

export function clientIp(request: Request | Headers): string {
  const h = request instanceof Headers ? request : request.headers;
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}
