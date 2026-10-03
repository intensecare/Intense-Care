"use client";

import React, { useState } from "react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { useApp } from "@/lib/app-context";
import {
  Save,
  CheckCircle2,
  Database,
  ShieldCheck,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import { SmsGatewayLog } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export default function SettingsPage() {
  const {
    systemSettings,
    updateSystemSettings,
    fontSize,
    setFontSize,
    smsGatewayLogs,
    fetchSmsGatewayLog,
  } = useApp();
  const { currentUser } = useAuth();

  const [otpExpiryMinutes, setOtpExpiryMinutes] = useState(systemSettings.otpExpiryMinutes || 15);
  const [otpMaxRetries, setOtpMaxRetries] = useState(systemSettings.otpMaxRetries || 3);
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(systemSettings.resendCooldownSeconds || 60);
  const [nextDayDispatchTime, setNextDayDispatchTime] = useState(systemSettings.nextDayDispatchTime || "20:00");
  const [taxRatePercent, setTaxRatePercent] = useState(
    systemSettings.taxRatePercent === undefined || systemSettings.taxRatePercent === null
      ? 18
      : systemSettings.taxRatePercent
  );
  const [taxLabel, setTaxLabel] = useState(systemSettings.taxLabel || "GST");
  const [gstin, setGstin] = useState(systemSettings.gstin || "");

  // Live 2Factor credit check (super_admin) — a delivery failure where the
  // provider accepts sends but messages never arrive (zero route credits,
  // template issues) is invisible in the dispatch logs; this surfaces it.
  const [balance, setBalance] = useState<{
    configured: boolean;
    mode?: string;
    otpSmsCredits?: string | null;
    transactionalSmsCredits?: string | null;
    error?: string;
  } | null>(null);
  const [balanceBusy, setBalanceBusy] = useState(false);

  const checkBalance = async () => {
    setBalanceBusy(true);
    try {
      const res = await fetch("/api/sms/balance");
      const json = await res.json().catch(() => null);
      if (json?.success) setBalance(json.data);
      else setBalance({ configured: true, error: "balance_check_failed" });
    } catch {
      setBalance({ configured: true, error: "network_error" });
    } finally {
      setBalanceBusy(false);
    }
  };
  const [sacCode, setSacCode] = useState(systemSettings.sacCode || "");
  const [googleReviewUrl, setGoogleReviewUrl] = useState(systemSettings.googleBusinessReviewUrl || "");
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    await updateSystemSettings({
      otpExpiryMinutes,
      otpMaxRetries,
      resendCooldownSeconds,
      nextDayDispatchTime,
      taxRatePercent: Math.min(100, Math.max(0, Number(taxRatePercent) || 0)),
      taxLabel: taxLabel.trim() || "GST",
      gstin: gstin.trim(),
      sacCode: sacCode.trim(),
      googleBusinessReviewUrl: googleReviewUrl.trim(),
    });
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
    setIsSaving(false);
  };

  return (
    <AdminLayout>
      <PageHeader
        title="Settings & System Configuration"
        description="Operational configuration, tax parameters, accessibility options, and gateway health."
        breadcrumbs={[
          { label: "Operations", href: "/" },
          { label: "Settings" },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Signed-in identity */}
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-slate-900" />
                Session Identity
              </h3>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/80 text-[11px] space-y-1">
              <div className="flex justify-between text-slate-600">
                <span>Signed in as:</span>
                <span className="font-semibold text-slate-900">{currentUser?.name}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Email:</span>
                <span className="font-mono text-slate-800">{currentUser?.email}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Role:</span>
                <span className="font-semibold uppercase text-slate-800">
                  {currentUser?.role.replace("_", " ")}
                </span>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Authentication is database-backed (bcrypt password verification). Accounts are
              provisioned by administrators in Users &amp; Roles.
            </p>
          </div>

          {/* Gateway health */}
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Database className="h-4 w-4 text-slate-900" />
                SMS Gateway Health
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                {smsGatewayLogs.length} dispatches
              </span>
            </div>

            {currentUser?.role === "super_admin" && (
              <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-700">2Factor Account Credits</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] gap-1"
                    disabled={balanceBusy}
                    onClick={() => void checkBalance()}
                  >
                    <RefreshCw className={`h-3 w-3 ${balanceBusy ? "animate-spin" : ""}`} />
                    {balanceBusy ? "Checking…" : "Check Live"}
                  </Button>
                </div>
                {balance && (
                  <div className="text-[11px] space-y-1">
                    <div className="text-slate-600">
                      Delivery mode: <strong className="font-mono">{balance.mode}</strong>
                      {balance.mode === "autogen" && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                          shared template route
                        </span>
                      )}
                    </div>
                    {balance.error ? (
                      <span className="text-rose-700 font-medium">Provider error: {balance.error}</span>
                    ) : (
                      <div className="flex gap-4">
                        <span className={Number(balance.otpSmsCredits ?? 0) > 0 ? "text-emerald-700" : "text-rose-700 font-bold"}>
                          OTP/SMS credits: <strong>{balance.otpSmsCredits ?? "—"}</strong>
                        </span>
                        <span className={Number(balance.transactionalSmsCredits ?? 0) > 0 ? "text-emerald-700" : "text-rose-700 font-bold"}>
                          Transactional: <strong>{balance.transactionalSmsCredits ?? "—"}</strong>
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/80 text-[11px] space-y-1 max-h-40 overflow-y-auto">
              {smsGatewayLogs.length === 0 ? (
                <span className="text-slate-400">No dispatches recorded yet.</span>
              ) : (
                smsGatewayLogs.slice(0, 10).map((log: SmsGatewayLog) => (
                  <div key={log.id} className="flex justify-between text-slate-600">
                    <span className="font-mono truncate">{log.jobId || "—"} · {log.recipientMasked}</span>
                    <span
                      className={`font-semibold ${
                        log.status === "SENT"
                          ? "text-emerald-700"
                          : log.status === "FAILED"
                          ? "text-rose-700"
                          : "text-amber-700"
                      }`}
                    >
                      {log.status}
                    </span>
                  </div>
                ))
              )}
            </div>
            <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => void fetchSmsGatewayLog()}>
              Refresh Gateway Log
            </Button>
          </div>

          {/* Typography & Font Size Accessibility (Govt Website Style) */}
          <div className="bg-white rounded-lg border border-zinc-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-900 flex items-center gap-1.5 font-sans">
                Accessibility Font Size Scaler
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-100 text-zinc-900 font-bold border border-zinc-300">
                Govt Portal Style
              </span>
            </div>

            <div className="grid grid-cols-4 gap-2 pt-1 font-mono">
              <button
                type="button"
                onClick={() => setFontSize("sm")}
                className={`p-3 rounded border text-center transition-all flex flex-col items-center gap-1 ${
                  fontSize === "sm"
                    ? "bg-black text-white border-black font-bold"
                    : "bg-zinc-50 text-zinc-700 border-zinc-200 hover:bg-zinc-100"
                }`}
              >
                <span className="text-base font-bold">-A</span>
                <span className="text-[10px] uppercase">Compact</span>
              </button>

              <button
                type="button"
                onClick={() => setFontSize("md")}
                className={`p-3 rounded border text-center transition-all flex flex-col items-center gap-1 ${
                  fontSize === "md"
                    ? "bg-black text-white border-black font-bold"
                    : "bg-zinc-50 text-zinc-700 border-zinc-200 hover:bg-zinc-100"
                }`}
              >
                <span className="text-base font-bold">A</span>
                <span className="text-[10px] uppercase">Standard</span>
              </button>

              <button
                type="button"
                onClick={() => setFontSize("lg")}
                className={`p-3 rounded border text-center transition-all flex flex-col items-center gap-1 ${
                  fontSize === "lg"
                    ? "bg-black text-white border-black font-bold"
                    : "bg-zinc-50 text-zinc-700 border-zinc-200 hover:bg-zinc-100"
                }`}
              >
                <span className="text-base font-bold">+A</span>
                <span className="text-[10px] uppercase">Large</span>
              </button>

              <button
                type="button"
                onClick={() => setFontSize("xl")}
                className={`p-3 rounded border text-center transition-all flex flex-col items-center gap-1 ${
                  fontSize === "xl"
                    ? "bg-black text-white border-black font-bold"
                    : "bg-zinc-50 text-zinc-700 border-zinc-200 hover:bg-zinc-100"
                }`}
              >
                <span className="text-base font-bold">++A</span>
                <span className="text-[10px] uppercase">X-Large</span>
              </button>
            </div>
          </div>
        </div>

        {/* Platform Settings Form */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Operational Configuration
            </h3>

            <form onSubmit={handleSave} className="space-y-4 text-xs">
              <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-900 leading-relaxed">
                <strong>Security notice:</strong> OTP expiry, attempt limits, resend cooldowns, and SMS
                rate caps are enforced <strong>server-side</strong> from environment variables (see{" "}
                <code className="font-mono bg-amber-100 px-1 rounded">.env.example</code>). Values below
                are operational display defaults only and do not weaken gateway security.
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">
                  Next-Day Job Dispatch Time (24h Format)
                </label>
                <Input
                  type="time"
                  value={nextDayDispatchTime}
                  onChange={(e) => setNextDayDispatchTime(e.target.value)}
                  className="text-xs font-mono"
                />
                <p className="text-[10px] text-slate-400">
                  Default 20:00 (8:00 PM). Operations Manager sees next day's job queue starting at this time.
                </p>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">OTP Expiry Window (Minutes)</label>
                <Input
                  type="number"
                  value={otpExpiryMinutes}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setOtpExpiryMinutes(e.target.value === "" ? 0 : Number(e.target.value))}
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Max OTP Verification Attempts</label>
                <Input
                  type="number"
                  value={otpMaxRetries}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setOtpMaxRetries(e.target.value === "" ? 0 : Number(e.target.value))}
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Resend Cooldown (Seconds)</label>
                <Input
                  type="number"
                  value={resendCooldownSeconds}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setResendCooldownSeconds(e.target.value === "" ? 0 : Number(e.target.value))}
                  className="text-xs"
                />
              </div>

              <div className="pt-2 border-t border-slate-100 space-y-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Taxation (GST)
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Tax Rate (%)</label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={taxRatePercent}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setTaxRatePercent(e.target.value === "" ? 0 : Number(e.target.value))}
                    className="text-xs"
                  />
                  <p className="text-[10px] text-slate-400">
                    Applied to new invoices and quotes. Set 0 to disable tax. Already-issued invoices keep their original figures.
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Tax Label (printed on invoices)</label>
                  <Input
                    type="text"
                    value={taxLabel}
                    onChange={(e) => setTaxLabel(e.target.value)}
                    placeholder="GST"
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Business GSTIN (printed on invoices)</label>
                  <Input
                    type="text"
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value)}
                    placeholder="e.g. 29AAACA9921K1Z2"
                    className="text-xs font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">SAC Code (printed on invoices)</label>
                  <Input
                    type="text"
                    value={sacCode}
                    onChange={(e) => setSacCode(e.target.value)}
                    placeholder="e.g. 998533"
                    className="text-xs font-mono"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 space-y-1">
                <label className="font-semibold text-slate-700">
                  Google Business Profile Review Link
                </label>
                <Input
                  value={googleReviewUrl}
                  onChange={(e) => setGoogleReviewUrl(e.target.value)}
                  className="text-xs font-mono"
                />
                <p className="text-[10px] text-slate-400">
                  Official review URL provided to customers upon completion (ungated). Leave empty to hide the prompt.
                </p>
              </div>

              <div className="pt-2">
                <Button type="submit" size="sm" className="w-full bg-slate-900 text-white" disabled={isSaving}>
                  {isSaving ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-3.5 w-3.5 mr-1.5" />
                      Save Settings
                    </>
                  )}
                </Button>
                {savedSuccess && (
                  <p className="text-[11px] text-emerald-700 font-semibold text-center mt-2 flex items-center justify-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Configuration saved!
                  </p>
                )}
              </div>
            </form>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
