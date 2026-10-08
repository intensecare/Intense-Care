"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { usePathname, useRouter } from "next/navigation";
import { ShieldAlert, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { routeAllowed, isPublicPath, homePathFor, ROLE_LABELS } from "@/lib/rbac";

/**
 * Route guard — every path is checked against the role's workspace table
 * (src/lib/rbac/workspaces.ts). A role that may not open a path is sent to
 * its ONE home. Public paths (login, customer secure link, partner code
 * portal) never require a session. This is a UX guard; APIs re-check.
 */
export function RouteGuard({ children }: { children: React.ReactNode }) {
  const { currentUser, isAuthenticated, isLoading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const publicPath = isPublicPath(pathname);
  let redirectTarget: string | null = null;

  if (mounted && !isLoading && !publicPath && (!isAuthenticated || !currentUser)) {
    redirectTarget = "/login";
  }

  if (mounted && !publicPath && isAuthenticated && currentUser) {
    const home = homePathFor(currentUser.role);
    if (pathname === "/" && home !== "/") {
      redirectTarget = home;
    } else if (!routeAllowed(currentUser.role, pathname) && pathname !== home) {
      redirectTarget = home;
    }
  }

  // A signed-in user opening /login goes straight to their workspace.
  if (mounted && !isLoading && pathname.startsWith("/login") && isAuthenticated && currentUser) {
    redirectTarget = homePathFor(currentUser.role);
  }

  useEffect(() => {
    if (redirectTarget) router.replace(redirectTarget);
  }, [redirectTarget, router]);

  if (!mounted || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-xs text-slate-400 font-mono">Verifying your session…</div>
      </div>
    );
  }

  if (publicPath && !redirectTarget) {
    return <>{children}</>;
  }

  if (redirectTarget) {
    const home = currentUser ? homePathFor(currentUser.role) : "/login";
    if (isAuthenticated && currentUser && home === pathname) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-lg border border-slate-200 p-6 shadow-sm text-center space-y-4">
            <div className="h-12 w-12 rounded-full bg-red-50 text-red-600 border border-red-200 flex items-center justify-center mx-auto">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-slate-900">Access Restricted</h2>
              <p className="text-xs text-slate-500 leading-relaxed">
                You are signed in as <strong className="text-slate-800">{currentUser.name}</strong> (
                {ROLE_LABELS[currentUser.role]}). This page is not part of your workspace.
              </p>
            </div>
            <div className="pt-2 flex flex-col gap-2">
              <Button className="w-full text-white" onClick={() => router.push(home)}>
                Go to my workspace
              </Button>
              <Button variant="outline" className="w-full text-slate-600" onClick={logout}>
                <LogOut className="h-3.5 w-3.5 mr-1.5" /> Sign out
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-xs text-slate-400 font-mono">Opening your workspace…</div>
      </div>
    );
  }

  return <>{children}</>;
}
