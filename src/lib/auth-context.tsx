"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { User, UserRole } from "./types";
import { useRouter, usePathname } from "next/navigation";

interface AuthContextType {
  currentUser: User | null;
  isAuthenticated: boolean;
  /** True while the server session is being resolved (page load / refresh).
   *  Guards must NOT redirect to /login until this settles. */
  isLoading: boolean;
  /** Verifies credentials against the database via POST /api/auth/login. */
  login: (email: string, password: string) => Promise<{ success: boolean; message?: string }>;
  logout: () => void;
  hasPermission: (allowedRoles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Routes allowed for each role
export const ROLE_ROUTE_PERMISSIONS: Record<UserRole, string[]> = {
  super_admin: [
    "/",
    "/jobs",
    "/quotations",
    "/dispatcher",
    "/calendar",
    "/customers",
    "/properties",
    "/services",
    "/quality",
    "/finance",
    "/referrals",
    "/reports",
    "/notifications",
    "/users",
    "/settings",
    "/field",
  ],
  ops_manager: [
    "/",
    "/jobs",
    "/dispatcher",
    "/calendar",
    "/customers",
    "/properties",
    "/services",
    "/quality",
    "/reports",
    "/notifications",
    "/field",
  ],
  staff: ["/field"],
};

// Primary entry path for each role
export function getRoleDefaultPath(role: UserRole): string {
  switch (role) {
    case "staff":
      return "/field";
    case "ops_manager":
    case "super_admin":
    default:
      return "/";
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  // Resolve the signed-in user from the server session (httpOnly cookie).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/session");
        const json = await res.json().catch(() => null);
        if (!cancelled) {
          if (res.ok && json?.success && json.data) {
            const u = json.data;
            setCurrentUser({
              id: u.id,
              name: u.name,
              email: u.email,
              phone: "",
              role: u.role as UserRole,
              active: true,
              createdAt: new Date().toISOString(),
            });
          } else {
            setCurrentUser(null);
          }
        }
      } catch (e) {
        if (!cancelled) setCurrentUser(null);
      } finally {
        if (!cancelled) setIsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (
    email: string,
    password: string
  ): Promise<{ success: boolean; message?: string }> => {
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

      const u = json.data;
      setCurrentUser({
        id: u.id,
        name: u.name,
        email: u.email,
        phone: "",
        role: u.role as UserRole,
        active: true,
        createdAt: new Date().toISOString(),
      });

      // Route user to their primary role page
      router.push(getRoleDefaultPath(u.role as UserRole));
      return { success: true };
    } catch (err) {
      return { success: false, message: "Network error during sign-in. Please retry." };
    }
  };

  const logout = () => {
    setCurrentUser(null);
    // Clear the server session cookie as well.
    fetch("/api/auth/session", { method: "DELETE" }).catch(() => {});
    router.push("/login");
  };

  const hasPermission = (allowedRoles: UserRole[]): boolean => {
    if (!currentUser) return false;
    if (currentUser.role === "super_admin") return true;
    return allowedRoles.includes(currentUser.role);
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isAuthenticated: !!currentUser,
        isLoading: !isLoaded,
        login,
        logout,
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
