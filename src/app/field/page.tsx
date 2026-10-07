"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { homePathFor } from "@/lib/rbac";

/**
 * /field — legacy entry point. The field app now lives in the role
 * workspaces: Field Managers → /my-jobs, Field Staff → /my-tasks.
 * Everyone else is sent to their own home.
 */
export default function FieldRedirectPage() {
  const { currentUser, isLoading, can } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (isLoading || !currentUser) return;
    if (currentUser.role === "field_staff") router.replace("/my-tasks");
    else if (can("jobs.arrive")) router.replace("/my-jobs");
    else router.replace(homePathFor(currentUser.role));
  }, [currentUser, isLoading, can, router]);
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-xs text-slate-400 font-mono">Opening the field app…</div>
    </div>
  );
}
