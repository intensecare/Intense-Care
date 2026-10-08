"use client";

import React, { Suspense } from "react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { MobileLayout } from "@/components/common/MobileLayout";
import { IntenseAIChat } from "@/components/ai/IntenseAIChat";
import { useAuth } from "@/lib/auth-context";

/** Intense AI — one page for every signed-in role, inside that role's own app shell. */
function AssistantPage() {
  const { currentUser, workspace } = useAuth();
  if (!currentUser) return null;
  const chat = (dock: "desk" | "mobile") => (
    <IntenseAIChat role={currentUser.role} userName={currentUser.name} storageKey={`intense-ai:${currentUser.id}`} dock={dock} />
  );
  if (workspace.layout === "mobile") {
    return <MobileLayout title="Intense AI" subtitle="Assistant">{chat("mobile")}</MobileLayout>;
  }
  return (
    <AdminLayout>
      <div className="max-w-3xl mx-auto">{chat("desk")}</div>
    </AdminLayout>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AssistantPage />
    </Suspense>
  );
}
