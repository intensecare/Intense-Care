"use client";

import React, { useEffect, useState } from "react";
import { useAuth, ROLE_ROUTE_PERMISSIONS, getRoleDefaultPath } from "@/lib/auth-context";
import { UserRole } from "@/lib/types";
import { usePathname, useRouter } from "next/navigation";
import { ShieldAlert, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RouteGuardProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}

export function RouteGuard({ children, allowedRoles }: RouteGuardProps) {
  const { currentUser, isAuthenticated, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Public paths that do not require staff authentication
  const isPublicPath =
    pathname.startsWith("/login") ||
    pathname.startsWith("/portal") ||
    pathname.startsWith("/partner-portal");

  // Compute the redirect target (if any) BEFORE rendering, then perform it in an
  // effect. Calling router.push during render caused React warnings ("Cannot
  // update a component while rendering a different component") because it
  // triggers a state update in the router during the render phase.
  let redirectTarget: string | null = null;

  if (mounted && !isPublicPath && (!isAuthenticated || !currentUser)) {
    redirectTarget = "/login";
  }

  if (mounted && !isPublicPath && isAuthenticated && currentUser) {
    const userRole = currentUser.role;

    // Auto-redirect non-admin roles from root "/" to their primary workspace
    if (pathname === "/") {
      const defaultPath = getRoleDefaultPath(userRole);
      if (defaultPath !== "/") {
        redirectTarget = defaultPath;
      }
    }

    if (!redirectTarget) {
      const isSuperAdmin = userRole === "super_admin";
      let isAllowed = isSuperAdmin;

      if (!isAllowed) {
        if (allowedRoles) {
          isAllowed = allowedRoles.includes(userRole);
        } else {
          // Check default permissions for this path
          const allowedPaths = ROLE_ROUTE_PERMISSIONS[userRole] || [];
          isAllowed = allowedPaths.some(
            (p) => p === pathname || (p !== "/" && pathname.startsWith(p))
          );
        }
      }

      // Unauthorized: bounce to the role's designated workspace instead of rendering
      if (!isAllowed) {
        const defaultPath = getRoleDefaultPath(userRole);
        if (defaultPath !== pathname) {
          redirectTarget = defaultPath;
        }
      }
    }
  }

  // Perform redirects after render (React-safe)
  useEffect(() => {
    if (redirectTarget) {
      router.replace(redirectTarget);
    }
  }, [redirectTarget, router]);

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-xs text-slate-400 font-mono">Verifying authentication session...</div>
      </div>
    );
  }

  if (isPublicPath) {
    return <>{children}</>;
  }

  // Render a neutral loading shell while a redirect is in flight
  if (redirectTarget) {
    // Special case: user is authenticated but genuinely has no workspace for this
    // path and their default path IS this path — show a proper access-restricted card.
    const userRole = currentUser?.role;
    const defaultPath = userRole ? getRoleDefaultPath(userRole) : "/login";

    if (isAuthenticated && currentUser && defaultPath === pathname) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-xl border border-slate-200 p-6 shadow-sm text-center space-y-4">
            <div className="h-12 w-12 rounded-full bg-rose-50 text-rose-600 border border-rose-200 flex items-center justify-center mx-auto">
              <ShieldAlert className="h-6 w-6" />
            </div>

            <div className="space-y-1">
              <h2 className="text-lg font-bold text-slate-900">
                Access Restricted
              </h2>
              <p className="text-xs text-slate-500 leading-relaxed">
                Your account is signed in as <strong className="text-slate-800">{currentUser.name}</strong> with role{" "}
                <span className="font-semibold uppercase text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded">
                  {currentUser.role.replace("_", " ")}
                </span>
                . You do not have permission to access this page under your current user role.
              </p>
            </div>

            <div className="pt-2 flex flex-col gap-2">
              <Button
                className="w-full bg-slate-900 text-white text-xs h-9"
                onClick={() => router.push(defaultPath)}
              >
                Go to Workspace ({defaultPath})
              </Button>
              <Button
                variant="outline"
                className="w-full text-xs h-9 text-slate-600"
                onClick={logout}
              >
                Sign Out & Switch Account
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-xs text-slate-400 font-mono">Redirecting to your workspace...</div>
      </div>
    );
  }

  return <>{children}</>;
}
