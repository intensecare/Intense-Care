"use client";

import React from "react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { MobileLayout } from "@/components/common/MobileLayout";
import { useAuth } from "@/lib/auth-context";

/**
 * QC works from a phone on site, so the Quality screens use the mobile shell
 * for the QC role; Admin opens the same screens inside the Operations desk.
 */
export function QualityShell({
  title,
  subtitle,
  backHref,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  backHref?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { currentUser } = useAuth();
  if (currentUser?.role === "qc_inspector") {
    return (
      <MobileLayout title={title} subtitle={subtitle ?? "Quality"} backHref={backHref} action={action}>
        {children}
      </MobileLayout>
    );
  }
  return (
    <AdminLayout>
      <div className="max-w-2xl mx-auto space-y-4 pb-28">
        <div>
          {backHref && (
            <a href={backHref} className="text-sm text-zinc-500 hover:text-zinc-900">← Quality</a>
          )}
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mt-1">{subtitle ?? "Quality"}</div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-zinc-950">{title}</h1>
        </div>
        {children}
      </div>
      {action && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] lg:bottom-0 lg:left-64 z-30 bg-white/95 backdrop-blur border-t border-zinc-200 p-3">
          <div className="max-w-2xl mx-auto">{action}</div>
        </div>
      )}
    </AdminLayout>
  );
}
