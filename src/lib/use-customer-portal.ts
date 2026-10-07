"use client";

import { useCallback, useEffect, useState } from "react";
import type { NextAction } from "./rbac";

/** GET /api/me/customer — the customer portal payload ("My Services"). */
export interface CustomerService {
  id: string;
  stage: string;
  journeyIndex: number;
  scheduledDate: string;
  scheduledTimeSlot: string;
  serviceName: string;
  property: { title: string; address: string };
  isToday: boolean;
  isUpcoming: boolean;
  isDone: boolean;
  isCancelled: boolean;
  qualityChecked: boolean;
  hasPhotos: boolean;
  approvedAt: string | null;
  rating: number | null;
  link: string | null;
  nextAction: NextAction | null;
}

export interface CustomerPortalPayload {
  customer: { id: string; name: string; phone: string; email: string; address: string };
  features: { amc: boolean; nri: boolean };
  properties: { id: string; title: string; address: string; city: string; propertyType: string }[];
  services: CustomerService[];
  invoices: { id: string; invoiceNumber: string; jobId: string; total: number; amountPaid: number; balanceDue: number; dueDate: string; status: string; issuedAt: string; finalized: boolean }[];
  payments: { id: string; invoiceId: string; amount: number; method: string; paidAt: string }[];
  amc: {
    id: string;
    contractNumber: string;
    propertyTitle: string;
    startDate: string;
    endDate: string;
    status: string;
    paymentStatus: string;
    contractValue: number;
    frequency: string;
    includedServices: string[];
    nri: boolean;
    localContactName: string | null;
    upcomingVisits: { id: string; visitNumber: number; scheduledDate: string; jobId: string | null }[];
    visitHistory: { id: string; visitNumber: number; scheduledDate: string; completedAt: string | null; jobId: string | null; qcScore: number | null; issuesFound: string | null; recommendations: string | null; approved: boolean | null }[];
  }[];
  company: { name: string; googleReviewUrl: string };
}

export function useCustomerPortal(pollMs = 15000) {
  const [data, setData] = useState<CustomerPortalPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/me/customer");
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setData(json.data);
        setError(null);
      } else setError(json?.error || "Could not load your services.");
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);

  return { data, error, loading, refresh: load };
}
