"use client";

import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Shimmering placeholder block. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("ds-skeleton rounded-xl", className)} />;
}

/** A stack of card-shaped skeletons for lists. */
export function SkeletonList({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-3">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** Friendly error with a retry — never a raw status code. */
export function ErrorState({ message = "Something went wrong while loading this page.", onRetry, className }: { message?: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("rounded-2xl border border-red-200 bg-red-50 p-5 flex flex-col sm:flex-row sm:items-center gap-3", className)}>
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" aria-hidden />
        <p className="text-sm text-red-800">{message}</p>
      </div>
      {onRetry && (
        <Button variant="outline" onClick={onRetry} className="shrink-0">
          <RefreshCw className="h-4 w-4" /> Try again
        </Button>
      )}
    </div>
  );
}

/** Inline success / error message after an action. */
export function Notice({ tone, children, className }: { tone: "success" | "error" | "warning" | "info"; children: React.ReactNode; className?: string }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-2xl px-4 py-3 text-sm font-medium flex items-start gap-2 animate-in fade-in slide-in-from-top-1",
        tone === "success" && "bg-emerald-600 text-white",
        tone === "error" && "bg-red-50 border border-red-200 text-red-800",
        tone === "warning" && "bg-amber-50 border border-amber-200 text-amber-800",
        tone === "info" && "bg-info-50 border border-info-200 text-info-700",
        className
      )}
    >
      {tone === "success" ? <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden /> : <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />}
      <span>{children}</span>
    </div>
  );
}

/** Banner shown while the device is offline. */
export function OfflineBanner() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (online) return null;
  return (
    <div role="status" className="rounded-2xl bg-zinc-900 text-white px-4 py-3 text-sm flex items-center gap-2">
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden /> You&apos;re offline. Changes will go through when the connection returns.
    </div>
  );
}
