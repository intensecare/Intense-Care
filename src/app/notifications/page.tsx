"use client";

import React, { useEffect, useState } from "react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { useApp } from "@/lib/app-context";
import { formatDateTime } from "@/lib/utils";
import {
  MessageSquare,
  Smartphone,
  CheckCircle2,
  RefreshCw,
  XCircle,
  Clock,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SmsGatewayLog } from "@/lib/types";

export default function NotificationsPage() {
  const { smsGatewayLogs, fetchSmsGatewayLog } = useApp();

  const [purposeFilter, setPurposeFilter] = useState("ALL");
  const [loaded, setLoaded] = useState(false);

  // Load the server SMS gateway audit trail (masked) on mount.
  useEffect(() => {
    void fetchSmsGatewayLog().finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredLogs = smsGatewayLogs.filter(
    (l) => purposeFilter === "ALL" || l.purpose === purposeFilter
  );

  const sentCount = smsGatewayLogs.filter((l) => l.status === "SENT").length;
  const failedCount = smsGatewayLogs.filter((l) => l.status === "FAILED").length;

  return (
    <AdminLayout>
      <PageHeader
        title="SMS Gateway Dispatch Logs"
        description="Server-side audit trail of every 2Factor SMS dispatch: customer arrival OTPs. Recipients are masked; message bodies and provider session ids are never exposed."
        breadcrumbs={[
          { label: "Operations", href: "/" },
          { label: "Notifications" },
        ]}
        actions={
          <Button
            onClick={() => void fetchSmsGatewayLog()}
            size="sm"
            variant="outline"
            className="h-9 text-xs gap-1"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        }
      />

      {/* Summary strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <div className="p-4 rounded-lg border border-slate-200 bg-white shadow-xs">
          <div className="text-xs font-semibold text-slate-500">
            Total Dispatches
          </div>
          <div className="text-2xl font-semibold text-slate-900 mt-1">{smsGatewayLogs.length}</div>
        </div>
        <div className="p-4 rounded-lg border border-emerald-200 bg-emerald-50/50 shadow-xs">
          <div className="text-xs font-semibold text-emerald-700">
            Delivered
          </div>
          <div className="text-2xl font-semibold text-emerald-800 mt-1">{sentCount}</div>
        </div>
        <div className="p-4 rounded-lg border border-red-200 bg-red-50/50 shadow-xs">
          <div className="text-xs font-semibold text-red-700">
            Failed
          </div>
          <div className="text-2xl font-semibold text-red-800 mt-1">{failedCount}</div>
        </div>
      </div>

      {/* SMS Gateway (2Factor AUTOGEN OTP dispatches) */}
      <div className="bg-white border border-slate-200 rounded-lg mb-5 shadow-xs overflow-hidden">
        <div className="p-3.5 bg-slate-50/75 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-slate-700" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900">SMS Gateway — Arrival OTPs (2Factor)</h3>
              <p className="text-[11px] text-slate-500">
                Provider-generated OTPs delivered via 2Factor's pre-approved DLT template.
              </p>
            </div>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
            {smsGatewayLogs.length} dispatches
          </span>
        </div>

        {smsGatewayLogs.length === 0 ? (
          <div className="p-4 text-xs text-slate-400 text-center">
            {loaded ? "No OTP dispatches recorded yet." : "Loading dispatch history…"}
          </div>
        ) : (
          <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
            {smsGatewayLogs.map((log: SmsGatewayLog) => (
              <div key={log.id} className="p-3 flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold text-white bg-amber-600 shrink-0">
                    {log.purpose.replace(/_/g, " ")}
                  </span>
                  <span className="font-mono font-semibold text-slate-800 shrink-0">
                    {log.jobId || "—"}
                  </span>
                  <span className="text-slate-500 font-mono">to {log.recipientMasked}</span>
                  {log.error && (
                    <span className="text-red-600 text-[10px] truncate">{log.error}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className={`flex items-center gap-1 font-semibold ${
                      log.status === "SENT"
                        ? "text-emerald-700"
                        : log.status === "FAILED"
                        ? "text-red-700"
                        : "text-amber-700"
                    }`}
                  >
                    {log.status === "SENT" ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : log.status === "FAILED" ? (
                      <XCircle className="h-3.5 w-3.5" />
                    ) : (
                      <Clock className="h-3.5 w-3.5" />
                    )}
                    {log.status}
                  </span>
                  <span className="text-slate-400">{formatDateTime(log.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Purpose filter */}
      <div className="bg-white border border-slate-200 rounded-lg p-3.5 shadow-xs flex items-center gap-2">
        <span className="text-xs text-slate-500 font-medium">Filter:</span>
        <button
          onClick={() => setPurposeFilter("ALL")}
          className={`px-3 py-1 rounded text-xs font-semibold ${
            purposeFilter === "ALL" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }`}
        >
          All ({smsGatewayLogs.length})
        </button>
        <button
          onClick={() => setPurposeFilter("OTP_VERIFICATION")}
          className={`px-3 py-1 rounded text-xs font-semibold flex items-center gap-1 ${
            purposeFilter === "OTP_VERIFICATION" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }`}
        >
          <Smartphone className="h-3 w-3" />
          Arrival OTP
        </button>
      </div>

      {filteredLogs.length === 0 && smsGatewayLogs.length > 0 && (
        <EmptyState
          icon={MessageSquare}
          title="No dispatches for this filter"
          description="Adjust the filter to see other dispatch records."
        />
      )}
    </AdminLayout>
  );
}
