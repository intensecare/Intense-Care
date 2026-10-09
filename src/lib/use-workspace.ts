"use client";

import { useCallback, useEffect, useState } from "react";
import type { NextAction } from "./rbac";

/**
 * The ONE home payload of the signed-in role (GET /api/me/workspace).
 * Polled while the tab is visible so every workspace home stays live.
 */
export interface WorkspaceQueueItem {
  id: string;
  status: string;
  stage: string;
  scheduledDate: string;
  scheduledTimeSlot: string;
  customerName: string | null;
  propertyTitle: string | null;
  city: string | null;
  serviceName: string | null;
  nextAction: NextAction | null;
  actionable: boolean;
}

export interface WorkspaceAttentionItem {
  key: string;
  jobId: string | null;
  title: string;
  reason: string;
  href: string;
  tone: "alert" | "warning";
  kind?: "issue" | "qc" | "payment" | "rework" | "unassigned" | "upcoming" | "other";
}

export interface WorkspacePayload {
  role: string;
  workspace: { title: string; home: string; queue: string; layout: string };
  today: string;
  counts: {
    today: number;
    active: number;
    qcPending: number;
    rework: number;
    approvalPending: number;
    completed: number;
  };
  attention: WorkspaceAttentionItem[];
  queue: WorkspaceQueueItem[];
  finance?: { outstanding: number; overdueCount: number; collectedMonth: number; revenueMonth: number; pendingInvoices: number };
  feedback?: { average: number | null; count: number; low: number };
}

export function useWorkspace(pollMs = 15000) {
  const [data, setData] = useState<WorkspacePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/me/workspace");
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setData(json.data as WorkspacePayload);
        setError(null);
      } else {
        setError(json?.error || "Could not load your workspace.");
      }
    } catch {
      setError("Network error. Check your connection and retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, pollMs);
    return () => clearInterval(interval);
  }, [load, pollMs]);

  return { data, error, loading, refresh: load };
}
