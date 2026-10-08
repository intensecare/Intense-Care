"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function apiCall<T = unknown>(url: string, method: "POST" | "PATCH" | "GET" = "POST", payload?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: payload !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      if (res.status === 401) window.location.href = "/login";
      return { ok: false, error: json?.error || (res.status === 413 ? "That photo is too large." : "Something went wrong. Please try again.") };
    }
    return { ok: true, data: json.data as T };
  } catch {
    return { ok: false, error: "No connection. Check your internet and try again." };
  }
}

/**
 * Runs a backend action, tracks pending/error, and refreshes the server-rendered
 * page on success so every screen shows the database truth.
 */
export function useAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T = unknown>(url: string, payload?: unknown, method: "POST" | "PATCH" = "POST"): Promise<ApiResult<T>> => {
      setPending(true);
      setError(null);
      const r = await apiCall<T>(url, method, payload);
      setPending(false);
      if (!r.ok) setError(r.error);
      else router.refresh();
      return r;
    },
    [router]
  );

  return { run, pending, error, setError };
}
