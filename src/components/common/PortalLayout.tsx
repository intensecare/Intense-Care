"use client";

import React from "react";
import Link from "next/link";
import { LogOut, ChevronLeft } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

/**
 * Consumer-style shell for the external roles (customer, referral partner):
 * large typography, rounded cards, no internal navigation, no internal terms.
 */
export function PortalLayout({
  title,
  greeting,
  backHref,
  children,
}: {
  title?: string;
  greeting?: string;
  backHref?: string;
  children: React.ReactNode;
}) {
  const { logout, workspace } = useAuth();
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {backHref ? (
              <Link href={backHref} className="h-11 w-11 -ml-2 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100">
                <ChevronLeft className="h-6 w-6" />
              </Link>
            ) : (
              <div className="h-10 w-10 rounded-xl bg-white border border-slate-200 p-1.5 overflow-hidden shrink-0">
                <img src="/logo.png" alt="" className="h-full w-full object-contain" />
              </div>
            )}
            <div className="min-w-0">
              {greeting && <div className="text-xs font-medium text-slate-500 truncate">{greeting}</div>}
              <div className="text-lg font-semibold tracking-tight truncate">{title ?? workspace.title}</div>
            </div>
          </div>
          <button onClick={logout} className="h-11 px-3 rounded-full text-xs font-semibold text-slate-500 hover:bg-slate-100 inline-flex items-center gap-1.5">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </header>
      <main className="max-w-lg mx-auto px-4 py-5 space-y-5">{children}</main>
    </div>
  );
}
