"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { User, UserRole } from "./types";
import { useRouter } from "next/navigation";
import {
  can as rbacCan,
  scopeOf,
  homePathFor,
  workspaceFor,
  navFor,
  normalizeRole,
  type Permission,
  type Scope,
  type NavItem,
  type WorkspaceLayout,
} from "./rbac";

/**
 * Auth context — the signed-in identity plus the permission helpers every
 * page uses to decide what to SHOW. The server re-checks every action, so a
 * decision here is a rendering hint, never the guard.
 */

export interface SessionWorkspace {
  title: string;
  home: string;
  queue: string;
  layout: WorkspaceLayout;
  nav: NavItem[];
}

interface AuthContextType {
  currentUser: User | null;
  isAuthenticated: boolean;
  /** True while the server session is being resolved (page load / refresh). */
  isLoading: boolean;
  /** Human-readable role label from the central role table. */
  roleLabel: string;
  workspace: SessionWorkspace;
  login: (email: string, password: string) => Promise<{ success: boolean; message?: string }>;
  logout: () => Promise<void>;
  /** Does the signed-in role hold the permission with any scope? */
  can: (permission: Permission) => boolean;
  /** Effective scope of the permission for the signed-in role. */
  scope: (permission: Permission) => Scope;
  /** @deprecated use `can` — kept for existing call sites. */
  hasPermission: (allowedRoles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Primary entry path for each role (ONE home per role). */
export function getRoleDefaultPath(role: UserRole | string): string {
  return homePathFor(role);
}

function toUser(u: Record<string, unknown>): User {
  return {
    id: String(u.id),
    name: String(u.name ?? ""),
    email: String(u.email ?? ""),
    phone: "",
    role: normalizeRole(typeof u.role === "string" ? u.role : undefined),
    active: true,
    teamId: (u.teamId as string | null) ?? null,
    branchId: (u.branchId as string | null) ?? null,
    customerId: (u.customerId as string | null) ?? null,
    referralPartnerId: (u.referralPartnerId as string | null) ?? null,
    createdAt: new Date().toISOString(),
  };
}

function workspaceOf(role: UserRole | string): SessionWorkspace {
  const ws = workspaceFor(role);
  return { title: ws.title, home: ws.home, queue: ws.queue, layout: ws.layout, nav: navFor(role) };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [roleLabel, setRoleLabel] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/session");
        const json = await res.json().catch(() => null);
        if (!cancelled) {
          if (res.ok && json?.success && json.data) {
            setCurrentUser(toUser(json.data));
            setRoleLabel(String(json.data.roleLabel ?? ""));
          } else {
            setCurrentUser(null);
          }
        }
      } catch {
        if (!cancelled) setCurrentUser(null);
      } finally {
        if (!cancelled) setIsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (email: string, password: string): Promise<{ success: boolean; message?: string }> => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        return { success: false, message: json?.error || "Sign-in failed. Please retry." };
      }
      const u = toUser(json.data);
      setCurrentUser(u);
      setRoleLabel(String(json.data.roleLabel ?? ""));
      // ONE home per role — never a generic dashboard.
      router.push(homePathFor(u.role));
      return { success: true };
    } catch {
      return { success: false, message: "Network error during sign-in. Please retry." };
    }
  };

  /**
   * Sign out, in order: (1) the server revokes the session and expires the
   * cookie — awaited, so the next page load is already signed out;
   * (2) local/session storage is cleared; (3) a full-page replace to /login
   * drops every in-memory record and replaces this history entry, and the
   * page guard (src/middleware.ts) turns any Back navigation into /login.
   */
  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/session", { method: "DELETE", cache: "no-store", credentials: "same-origin" });
    } catch {
      // Offline: the cookie may survive, but the guard + server still re-check.
    }
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
    setCurrentUser(null);
    window.location.replace("/login");
  }, []);

  // Back/forward cache: a page restored after sign-out is re-checked, never shown.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  const role = currentUser?.role;
  const can = useCallback((permission: Permission) => (role ? rbacCan({ role }, permission) : false), [role]);
  const scope = useCallback((permission: Permission): Scope => (role ? scopeOf(role, permission) : "NONE"), [role]);
  const hasPermission = useCallback(
    (allowedRoles: UserRole[]) => (role ? role === "admin" || allowedRoles.includes(role) : false),
    [role]
  );
  const workspace = useMemo(() => workspaceOf(role ?? "customer"), [role]);

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isAuthenticated: !!currentUser,
        isLoading: !isLoaded,
        roleLabel,
        workspace,
        login,
        logout,
        can,
        scope,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

/** Shorthand for pages: `const can = usePermission(); can("jobs.assign")`. */
export function usePermission() {
  return useAuth().can;
}
